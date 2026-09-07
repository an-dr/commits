use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bones_engine::bus::{Envelope, Handler, Module, ModuleContext};
use bones_engine::logging::Logger;

/// Bus endpoint name the component addresses with a direct `send`.
pub const ENDPOINT: &str = "page";

/// File served to the webview, resolved next to the executable.
const PAGE_FILE: &str = "page.html";
/// Second route, for the loading page shown while the component starts.
const LOADING_FILE: &str = "loading.html";

/// Request byte asking for the loading page instead of the graph page.
///
/// The component sends an empty payload, so the graph page stays the default
/// and its request needs no change.
pub const LOADING_REQUEST: u8 = 1;

/// Resolves the standalone webview page on demand.
///
/// The page is served at request time rather than compiled into the component so
/// rebuilding the page does not require rebuilding the WebAssembly component.
/// This also mirrors the VS Code extension, whose host supplies webview HTML at
/// runtime instead of embedding it.
pub struct PageModule {
    url: Option<String>,
    loading_url: Option<String>,
    logger: Option<Logger>,
    shutdown: Arc<AtomicBool>,
}

impl Default for PageModule {
    fn default() -> Self {
        Self {
            url: None,
            loading_url: None,
            logger: None,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl PageModule {
    pub fn new(logger: Logger) -> Self {
        Self {
            logger: Some(logger),
            ..Self::default()
        }
    }

    /// Resolves the page file beside the running executable.
    fn resolve_page_path() -> Option<PathBuf> {
        let executable = std::env::current_exe().ok()?;
        Some(executable.parent()?.join(PAGE_FILE))
    }
}

impl Handler for PageModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for PageModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        let path = Self::resolve_page_path().ok_or("could not resolve page path")?;
        let listener = TcpListener::bind(("127.0.0.1", 0))
            .map_err(|error| format!("binding page server: {error}"))?;
        listener
            .set_nonblocking(true)
            .map_err(|error| format!("configuring page server: {error}"))?;
        let address = listener
            .local_addr()
            .map_err(|error| format!("reading page server address: {error}"))?;
        self.url = Some(format!("http://{address}/{PAGE_FILE}"));
        self.loading_url = Some(format!("http://{address}/{LOADING_FILE}"));

        let shutdown = Arc::clone(&self.shutdown);
        std::thread::Builder::new()
            .name("commits-page-server".to_string())
            .spawn(move || serve(listener, path, shutdown))
            .map_err(|error| format!("starting page server: {error}"))?;
        // Marks the end of window and webview creation in the log: everything
        // before this line is the engine getting a window on screen.
        if let Some(logger) = &self.logger {
            logger.info(ENDPOINT, &format!("page server listening on {address}"));
        }
        Ok(())
    }

    /// Answers a page request with a local URL. Keeping the page bytes out of
    /// the interpreted WASM boundary makes startup effectively constant-size.
    fn respond(&mut self, _sender: &str, payload: &[u8]) -> Option<Vec<u8>> {
        let url = match payload.first() {
            Some(&LOADING_REQUEST) => self.loading_url.as_deref(),
            _ => self.url.as_deref(),
        };
        Some(url.unwrap_or_default().as_bytes().to_vec())
    }

    fn shutdown(&mut self) {
        self.shutdown.store(true, Ordering::Relaxed);
    }
}

/// How long a connection may stay silent before it is dropped. WebKit opens
/// spare sockets it never sends a request on and only closes them when its own
/// idle timeout expires, a minute later; without a deadline of our own such a
/// socket occupies a reader for that whole minute.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);
/// Ceiling on a slow write of the page body, so a stalled client cannot pin a
/// thread indefinitely either.
const RESPONSE_TIMEOUT: Duration = Duration::from_secs(30);

fn serve(listener: TcpListener, page_path: PathBuf, shutdown: Arc<AtomicBool>) {
    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            // Each connection is answered on its own thread. Answering them in
            // turn on this one made the first silent socket block every later
            // request behind it, which is what kept the graph panel white for a
            // minute after launch: the page request sat unread in the kernel
            // buffer while this loop waited on a socket that never spoke.
            Ok((stream, _)) => {
                let page_path = page_path.clone();
                // A thread that cannot be spawned drops the connection, which
                // the webview retries; serving it here instead would reopen
                // exactly the blocking this split removes.
                let _ = std::thread::Builder::new()
                    .name("commits-page-connection".to_string())
                    .spawn(move || answer(stream, &page_path));
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break,
        }
    }
}

/// Prepares one accepted connection and answers it.
///
/// The listener is non-blocking so the accept loop can notice shutdown, but a
/// socket accepted from it is blocking on Linux and inherits the flag on some
/// other platforms; setting it explicitly makes the timeouts below the only
/// thing that ends a read.
fn answer(mut stream: TcpStream, page_path: &Path) {
    if stream.set_nonblocking(false).is_err() {
        return;
    }
    let _ = stream.set_read_timeout(Some(REQUEST_TIMEOUT));
    let _ = stream.set_write_timeout(Some(RESPONSE_TIMEOUT));
    respond_http(&mut stream, page_path);
}

fn respond_http(stream: &mut TcpStream, page_path: &Path) {
    let mut request = [0_u8; 1024];
    let Ok(read) = stream.read(&mut request) else {
        return;
    };
    let request = &request[..read];
    let wants = |file: &str| request.starts_with(format!("GET /{file} ").as_bytes());
    let (status, content_type, body) = if wants(PAGE_FILE) {
        match std::fs::read(page_path) {
            Ok(page) => ("200 OK", "text/html; charset=utf-8", page),
            Err(_) => (
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Page not found".to_vec(),
            ),
        }
    } else if wants(LOADING_FILE) {
        // Compiled in rather than read from disk: this is the one page that
        // has to answer while the main thread is busy loading the component,
        // so it cannot depend on a build step having produced a file.
        (
            "200 OK",
            "text/html; charset=utf-8",
            crate::splash::LOADING_PAGE.as_bytes().to_vec(),
        )
    } else {
        (
            "404 Not Found",
            "text/plain; charset=utf-8",
            b"Not found".to_vec(),
        )
    };
    let header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(header.as_bytes());
    let _ = stream.write_all(&body);
}

#[cfg(test)]
mod tests {
    use super::{serve, Module, PageModule, LOADING_REQUEST};
    use std::io::{Read, Write};
    use std::net::{TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::{Duration, Instant};

    fn served() -> PageModule {
        PageModule {
            url: Some("http://127.0.0.1:1/page.html".to_string()),
            loading_url: Some("http://127.0.0.1:1/loading.html".to_string()),
            ..PageModule::default()
        }
    }

    #[test]
    fn an_empty_request_still_answers_with_the_graph_page() {
        // The component sends no payload, so this is the path that must keep
        // working now that a second route shares the endpoint.
        let answer = served().respond("commits", &[]).unwrap();

        assert_eq!(
            String::from_utf8(answer).unwrap(),
            "http://127.0.0.1:1/page.html"
        );
    }

    #[test]
    fn the_loading_request_answers_with_the_loading_page() {
        let answer = served().respond("splash", &[LOADING_REQUEST]).unwrap();

        assert_eq!(
            String::from_utf8(answer).unwrap(),
            "http://127.0.0.1:1/loading.html"
        );
    }

    /// The launch bug this split fixes: WebKit opens a socket it does not
    /// send a request on, and the page request arrives on a second one. While
    /// connections were answered in turn, the silent socket held the reader
    /// until WebKit's own minute-long idle timeout closed it, and the graph
    /// panel stayed white for that whole minute.
    #[test]
    fn a_silent_connection_does_not_delay_the_next_request() {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let shutdown = Arc::new(AtomicBool::new(false));
        let stop = Arc::clone(&shutdown);
        let server = std::thread::spawn(move || serve(listener, PathBuf::new(), stop));

        // Opened first and never written to, exactly as the spare socket is.
        let silent = TcpStream::connect(address).unwrap();

        let started = Instant::now();
        let mut client = TcpStream::connect(address).unwrap();
        client.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        client
            .write_all(b"GET /loading.html HTTP/1.1\r\nHost: localhost\r\n\r\n")
            .unwrap();
        let mut answer = String::new();
        client.read_to_string(&mut answer).unwrap();
        let waited = started.elapsed();

        shutdown.store(true, Ordering::Relaxed);
        drop(silent);
        server.join().unwrap();

        assert!(answer.starts_with("HTTP/1.1 200 OK"), "answer: {answer}");
        assert!(
            waited < Duration::from_secs(2),
            "the silent connection held the request for {waited:?}"
        );
    }

    #[test]
    fn before_the_server_is_listening_the_answer_is_empty_not_a_broken_url() {
        let answer = PageModule::default()
            .respond("splash", &[LOADING_REQUEST])
            .unwrap();

        assert!(answer.is_empty());
    }
}
