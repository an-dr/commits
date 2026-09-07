//! An optional local channel for driving the window from outside it.
//!
//! The user interface is a webview, and a webview under Xwayland cannot be
//! clicked by synthetic X input: `XTestFakeButtonEvent` moves the pointer the
//! compositor draws, not the pointer the Wayland surface receives, so a
//! headless reproduction of "the button does nothing" was impossible to
//! script. Everything the interface does is a JSON message from the page to
//! the extension, though, so this module posts those messages directly and
//! records the ones the page sends. Driving the app at the message layer is
//! also steadier than clicking pixels: it survives a moved button.
//!
//! It also records the bus, which is the app's whole nervous system: what the
//! page asked for, what the extension asked the native modules for, and what
//! came back. A silent window is a bus that stopped, and this is how to see
//! where.
//!
//! Off unless `COMMITS_CONTROL_PORT` names a port, because it is an
//! unauthenticated hole into the running app -- anything that can reach the
//! port can act as the user. It binds to loopback only, and a shipped launch
//! never sets the variable.
//!
//! ```text
//! COMMITS_CONTROL_PORT=8642 ./commits
//! curl -s localhost:8642/health
//! curl -s -X POST --data-binary '{"command":"refresh"}' \
//!      'localhost:8642/page-message?owner=commits&panel=main'
//! curl -s localhost:8642/messages          # bus traffic, oldest first
//! curl -s 'localhost:8642/messages?topic=git/&limit=20'
//! ```

use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext};
use bones_engine::logging::Logger;
use bones_messages::web::PageMessage;
use bones_messages::{DecodeMessage, EncodeMessage, Message};

/// Bus endpoint name.
pub const ENDPOINT: &str = "control";
/// Environment variable naming the port to listen on. Absent means off.
const PORT_VARIABLE: &str = "COMMITS_CONTROL_PORT";
/// Cap on the recorded page messages, so a long session cannot grow without
/// bound while nothing reads them.
const HISTORY: usize = 500;
/// Matches the page server's deadlines; see `crate::page`.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);
/// Largest request accepted, which bounds a page message posted through it.
const MAX_REQUEST: usize = 256 * 1024;

/// One line of recorded bus traffic.
type Recorded = String;
/// Longest payload preview kept per envelope.
const PREVIEW: usize = 300;
/// The engine's frame tick. Recording every one would evict the history this
/// exists to keep -- sixty a second -- but dropping them entirely hides
/// whether the engine is still turning during a stall, so one per
/// `TICK_HEARTBEAT` is kept as a heartbeat.
const TICK_TOPIC: &str = "core/tick";
const TICK_HEARTBEAT: Duration = Duration::from_secs(1);

pub struct ControlModule {
    started: std::time::Instant,
    /// When the last tick heartbeat was recorded.
    last_tick: Option<std::time::Instant>,
    logger: Option<Logger>,
    bus: Option<Bus>,
    messages: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Arc<AtomicBool>,
}

impl Default for ControlModule {
    fn default() -> Self {
        Self {
            started: std::time::Instant::now(),
            last_tick: None,
            logger: None,
            bus: None,
            messages: Arc::new(Mutex::new(Vec::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl ControlModule {
    pub fn new(logger: Logger) -> Self {
        Self {
            logger: Some(logger),
            ..Self::default()
        }
    }

    fn log(&self, message: &str) {
        if let Some(logger) = &self.logger {
            logger.info(ENDPOINT, message);
        }
    }
}

impl Handler for ControlModule {
    /// Records the bus, which is the other half of driving the app: a test
    /// can post a message and then read what it caused without a screenshot,
    /// and a stall shows up as the topic the traffic stops at.
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic == TICK_TOPIC {
            let now = std::time::Instant::now();
            if self
                .last_tick
                .is_some_and(|last| now.duration_since(last) < TICK_HEARTBEAT)
            {
                return;
            }
            self.last_tick = Some(now);
        }
        let line = format!(
            "{:>7}ms\t{}\t{}\t{}",
            self.started.elapsed().as_millis(),
            envelope.topic,
            envelope.sender,
            preview(envelope)
        );
        let mut messages = self.messages.lock().unwrap();
        if messages.len() >= HISTORY {
            messages.remove(0);
        }
        messages.push(line);
    }
}

/// Renders a payload for a human reading the recording.
///
/// Page messages are JSON and stay readable as they are; everything else is
/// the binary codec, so it gets its length and whatever text it contains.
fn preview(envelope: &Envelope) -> String {
    if envelope.topic == "os/prompt-response" {
        return "[credential response redacted]".into();
    }
    if envelope.topic == PageMessage::TOPIC {
        if let Ok(message) = PageMessage::decode(&envelope.payload) {
            if serde_json::from_str::<serde_json::Value>(message.json)
                .ok()
                .is_some_and(|json| json["command"] == "credentialResponse")
            {
                return format!(
                    "{}/{} [credential response redacted]",
                    message.owner, message.panel
                );
            }
            return truncate(&format!(
                "{}/{} {}",
                message.owner, message.panel, message.json
            ));
        }
    }
    let text: String = envelope
        .payload
        .iter()
        .map(|byte| match byte.is_ascii_graphic() || *byte == b' ' {
            true => *byte as char,
            false => '.',
        })
        .collect();
    truncate(&format!("[{} bytes] {text}", envelope.payload.len()))
}

fn truncate(text: &str) -> String {
    match text.char_indices().nth(PREVIEW) {
        Some((end, _)) => format!("{}…", &text[..end]),
        None => text.to_string(),
    }
}

impl Module for ControlModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        let Some(port) = std::env::var(PORT_VARIABLE)
            .ok()
            .and_then(|port| port.trim().parse::<u16>().ok())
        else {
            return Ok(());
        };
        // Everything: a trailing `*` is a prefix match, so this is the
        // whole bus. Costly only in this build-time-optional module.
        context.subscribe("*");
        self.bus = context.get_service::<Bus>().cloned();
        let listener = TcpListener::bind(("127.0.0.1", port))
            .map_err(|error| format!("binding control channel: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("configuring control channel: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("reading control channel address: {error}"))?;

        let state = State {
            bus: self.bus.clone(),
            messages: Arc::clone(&self.messages),
            shutdown: Arc::clone(&self.shutdown),
        };
        std::thread::Builder::new()
            .name("commits-control".to_string())
            .spawn(move || serve(listener, state))
            .map_err(|error| format!("starting control channel: {error}"))?;
        self.log(&format!("control channel listening on {address}"));
        Ok(())
    }

    fn shutdown(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone)]
struct State {
    bus: Option<Bus>,
    messages: Arc<Mutex<Vec<Recorded>>>,
    shutdown: Arc<AtomicBool>,
}

fn serve(listener: TcpListener, state: State) {
    while !state.shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((stream, _)) => {
                let state = state.clone();
                let _ = std::thread::Builder::new()
                    .name("commits-control-connection".to_string())
                    .spawn(move || answer(stream, &state));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break,
        }
    }
}

fn answer(mut stream: TcpStream, state: &State) {
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(RESPONSE_TIMEOUT));
    let Some(request) = read_request(&mut stream) else {
        return;
    };
    let (status, body) = route(&request, state);
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}

struct Request {
    line: String,
    body: String,
}

/// Reads until the body announced by `Content-Length` has arrived.
///
/// A single `read` is enough for the page server, whose clients send a bare
/// GET, but a posted message is a second packet more often than not.
fn read_request(stream: &mut impl Read) -> Option<Request> {
    let mut buffer = Vec::new();
    let mut chunk = [0_u8; 8192];
    let headers_end = loop {
        if let Some(end) = find(&buffer, b"\r\n\r\n") {
            break end + 4;
        }
        if buffer.len() > MAX_REQUEST {
            return None;
        }
        match stream.read(&mut chunk) {
            Ok(0) | Err(_) => return None,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    };
    let head = String::from_utf8_lossy(&buffer[..headers_end]).into_owned();
    if headers_end > MAX_REQUEST {
        return None;
    }
    let mut length = None;
    for line in head.lines().skip(1).filter(|line| !line.is_empty()) {
        let (name, value) = line.split_once(':')?;
        let value = value.trim();
        // This channel is for local tools. Reject browser requests, including
        // cross-site form posts and DNS rebinding to a loopback address.
        if name.eq_ignore_ascii_case("origin") || name.eq_ignore_ascii_case("sec-fetch-site") {
            return None;
        }
        if name.eq_ignore_ascii_case("host") {
            let (host, port) = value.split_once(':').unwrap_or((value, ""));
            if !(host.eq_ignore_ascii_case("localhost") || host == "127.0.0.1")
                || (!port.is_empty() && port.parse::<u16>().is_err())
            {
                return None;
            }
        }
        if name.eq_ignore_ascii_case("transfer-encoding") {
            return None;
        }
        if name.eq_ignore_ascii_case("content-length") {
            if length.is_some() {
                return None;
            }
            length = Some(value.parse::<usize>().ok()?);
        }
    }
    let length = length.unwrap_or(0);
    if length > MAX_REQUEST - headers_end {
        return None;
    }
    let end = headers_end + length;
    while buffer.len() < end {
        let remaining = (end - buffer.len()).min(chunk.len());
        match stream.read(&mut chunk[..remaining]) {
            Ok(0) | Err(_) => return None,
            Ok(read) => buffer.extend_from_slice(&chunk[..read]),
        }
    }
    Some(Request {
        line: head.lines().next().unwrap_or_default().to_string(),
        body: String::from_utf8(buffer[headers_end..end].to_vec()).ok()?,
    })
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn route(request: &Request, state: &State) -> (&'static str, String) {
    let mut parts = request.line.split_whitespace();
    let method = parts.next().unwrap_or_default();
    let target = parts.next().unwrap_or_default();
    let (path, query) = target.split_once('?').unwrap_or((target, ""));
    match (method, path) {
        ("GET", "/health") => ("200 OK", "ok\n".to_string()),
        ("GET", "/messages") => {
            let messages = state.messages.lock().unwrap();
            let topic = parameter(query, "topic");
            let mut selected: Vec<&String> = messages
                .iter()
                .filter(|line| match &topic {
                    // The topic is the second tab-separated field.
                    Some(prefix) => line
                        .split('\t')
                        .nth(1)
                        .is_some_and(|candidate| candidate.starts_with(prefix.as_str())),
                    None => true,
                })
                .collect();
            if let Some(limit) = parameter(query, "limit").and_then(|l| l.parse::<usize>().ok()) {
                selected = selected.split_off(selected.len().saturating_sub(limit));
            }
            let body: Vec<&str> = selected.iter().map(|line| line.as_str()).collect();
            ("200 OK", format!("{}\n", body.join("\n")))
        }
        ("POST", "/messages/clear") => {
            state.messages.lock().unwrap().clear();
            ("200 OK", "cleared\n".to_string())
        }
        ("POST", "/page-message") => post_page_message(query, &request.body, state),
        _ => (
            "404 Not Found",
            "routes: GET /health, GET /messages, POST /messages/clear, POST /page-message?owner=&panel=\n"
                .to_string(),
        ),
    }
}

/// Publishes the request body as if the named panel's page had posted it.
fn post_page_message(query: &str, body: &str, state: &State) -> (&'static str, String) {
    let owner = parameter(query, "owner").unwrap_or_else(|| "commits".to_string());
    let panel = parameter(query, "panel").unwrap_or_else(|| "main".to_string());
    let json = body.trim();
    if json.is_empty() {
        return ("400 Bad Request", "empty message body\n".to_string());
    }
    if serde_json::from_str::<serde_json::Value>(json).is_err() {
        return ("400 Bad Request", "invalid JSON message\n".into());
    }
    let Some(bus) = &state.bus else {
        return ("503 Service Unavailable", "no bus\n".to_string());
    };
    bus.publish(Envelope {
        topic: PageMessage::TOPIC.to_string(),
        // Named as the web module, because that is who this stands in for:
        // an extension filtering on the sender must not be able to tell a
        // driven message from a clicked one.
        sender: "web".to_string(),
        correlation: None,
        payload: PageMessage {
            owner: &owner,
            panel: &panel,
            json,
        }
        .encode(),
    });
    ("200 OK", format!("posted to {owner}/{panel}\n"))
}

fn parameter(query: &str, name: &str) -> Option<String> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then(|| value.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(line: &str, body: &str) -> Request {
        Request {
            line: line.to_string(),
            body: body.to_string(),
        }
    }

    fn state() -> State {
        State {
            bus: None,
            messages: Arc::new(Mutex::new(Vec::new())),
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }

    #[test]
    fn health_answers_without_a_bus() {
        let (status, body) = route(&request("GET /health HTTP/1.1", ""), &state());

        assert_eq!(status, "200 OK");
        assert_eq!(body, "ok\n");
    }

    #[test]
    fn recorded_traffic_can_be_filtered_by_topic() {
        let state = state();
        state.messages.lock().unwrap().extend([
            "      1ms\tweb/page-message\tweb\tcommits/main {\"a\":1}".to_string(),
            "      2ms\tgit/completed\tgit\t[4 bytes] ....".to_string(),
        ]);

        let (status, body) = route(&request("GET /messages?topic=git/ HTTP/1.1", ""), &state);

        assert_eq!(status, "200 OK");
        assert_eq!(body, "      2ms\tgit/completed\tgit\t[4 bytes] ....\n");
    }

    #[test]
    fn an_empty_post_is_rejected_rather_than_published_as_nothing() {
        let (status, _) = route(
            &request("POST /page-message?owner=commits&panel=main HTTP/1.1", "  "),
            &state(),
        );

        assert_eq!(status, "400 Bad Request");
    }

    #[test]
    fn a_post_without_a_bus_reports_that_rather_than_claiming_success() {
        let (status, _) = route(
            &request("POST /page-message HTTP/1.1", "{\"command\":\"refresh\"}"),
            &state(),
        );

        assert_eq!(status, "503 Service Unavailable");
    }

    #[test]
    fn the_panel_defaults_to_the_one_the_extension_owns() {
        assert_eq!(parameter("owner=x&panel=y", "owner").as_deref(), Some("x"));
        assert_eq!(parameter("owner=x&panel=y", "panel").as_deref(), Some("y"));
        assert_eq!(parameter("", "owner"), None);
    }

    #[test]
    fn an_unknown_route_lists_the_ones_that_exist() {
        let (status, body) = route(&request("GET /nope HTTP/1.1", ""), &state());

        assert_eq!(status, "404 Not Found");
        assert!(body.contains("/page-message"), "body: {body}");
    }

    #[test]
    fn a_recorded_message_keeps_its_panel_and_json() {
        let mut module = ControlModule::default();
        module.handle(&Envelope {
            topic: PageMessage::TOPIC.to_string(),
            sender: "web".to_string(),
            correlation: None,
            payload: PageMessage {
                owner: "commits",
                panel: "main",
                json: "{\"command\":\"refresh\"}",
            }
            .encode(),
        });

        let messages = module.messages.lock().unwrap();
        assert_eq!(messages.len(), 1);
        assert!(
            messages[0].contains("web/page-message\tweb\tcommits/main {\"command\":\"refresh\"}"),
            "recorded: {}",
            messages[0]
        );
    }

    /// One tick is kept so a stall is visible as a gap between heartbeats;
    /// the rest are dropped so they cannot evict everything else.
    #[test]
    fn the_frame_tick_is_recorded_only_as_a_heartbeat() {
        let mut module = ControlModule::default();
        let tick = Envelope {
            topic: TICK_TOPIC.to_string(),
            sender: "runner".to_string(),
            correlation: None,
            payload: vec![0, 1, 2, 3],
        };

        for _ in 0..100 {
            module.handle(&tick);
        }

        assert_eq!(module.messages.lock().unwrap().len(), 1);
    }

    #[test]
    fn history_is_bounded_so_a_long_session_cannot_grow_without_end() {
        let mut module = ControlModule::default();
        for index in 0..HISTORY + 10 {
            module.handle(&Envelope {
                topic: PageMessage::TOPIC.to_string(),
                sender: "web".to_string(),
                correlation: None,
                payload: PageMessage {
                    owner: "commits",
                    panel: "main",
                    json: &format!("{{\"n\":{index}}}"),
                }
                .encode(),
            });
        }

        let messages = module.messages.lock().unwrap();
        assert_eq!(messages.len(), HISTORY);
        assert!(messages
            .last()
            .unwrap()
            .contains(&format!("{}", HISTORY + 9)));
    }
}

#[cfg(test)]
mod review_tests {
    use super::*;

    fn parse(input: &str) -> Option<Request> {
        read_request(&mut input.as_bytes())
    }

    #[test]
    fn rejects_incomplete_oversized_and_ambiguous_bodies() {
        for headers in [
            "Content-Length: 9",
            "Content-Length: 999999",
            "Content-Length: nope",
            "Content-Length: 2\r\nContent-Length: 3",
            "Transfer-Encoding: chunked",
        ] {
            assert!(parse(&format!(
                "POST /page-message HTTP/1.1\r\n{headers}\r\n\r\n{{}}"
            ))
            .is_none());
        }
    }

    #[test]
    fn reads_only_the_announced_body() {
        let request =
            parse("POST /page-message HTTP/1.1\r\nContent-Length: 2\r\n\r\n{}extra").unwrap();
        assert_eq!(request.body, "{}");
    }

    #[test]
    fn rejects_browser_requests_and_rebound_hosts() {
        for header in [
            "Origin: https://example.com",
            "Sec-Fetch-Site: cross-site",
            "Host: attacker.example",
        ] {
            assert!(parse(&format!("POST /page-message HTTP/1.1\r\n{header}\r\n\r\n")).is_none());
        }
        assert!(parse("GET /health HTTP/1.1\r\nHost: localhost:8642\r\n\r\n").is_some());
    }

    #[test]
    fn credential_answers_do_not_enter_history() {
        for (topic, payload) in [
            (
                PageMessage::TOPIC,
                PageMessage {
                    owner: "commits",
                    panel: "main",
                    json: r#"{"command":"credentialResponse","id":"1","value":"secret"}"#,
                }
                .encode(),
            ),
            ("os/prompt-response", b"1\nsecret".to_vec()),
        ] {
            let text = preview(&Envelope {
                topic: topic.into(),
                sender: "test".into(),
                correlation: None,
                payload,
            });
            assert!(!text.contains("secret"));
            assert!(text.contains("redacted"));
        }
    }
}
