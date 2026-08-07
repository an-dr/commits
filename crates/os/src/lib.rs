use std::io::Read;
use std::sync::Arc;
use std::thread;
use std::time::Duration;

use base64::Engine;
use bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{NativeResult, OsRequest};

pub mod rendezvous;

pub const REQUEST_TOPIC: &str = "os/request";
pub const RESULT_TOPIC: &str = "os/result";
pub const PROMPT_TOPIC: &str = "os/prompt";
pub const PROMPT_RESPONSE_TOPIC: &str = "os/prompt-response";

/// Largest working-tree file the page is served. Beyond this the view would be
/// unusable anyway, and the text crosses the panel boundary as one string.
pub const MAX_FILE_READ_BYTES: u64 = 4 * 1024 * 1024;

/// Largest body accepted from `fetch_url`, an avatar-sized image or a small
/// manifest — never a bulk download.
pub const MAX_FETCH_BYTES: u64 = 5 * 1024 * 1024;
/// How long `fetch_url` waits before giving up, so a stalled remote never
/// blocks the OS module's request thread indefinitely.
pub const FETCH_TIMEOUT: Duration = Duration::from_secs(10);

pub trait OsBackend: Send + Sync {
    fn read_clipboard(&self) -> Result<String, String>;
    fn write_clipboard(&self, value: &str) -> Result<(), String>;
    fn open_url(&self, value: &str) -> Result<(), String>;
    /// Reveals a directory in the OS's native file manager (Explorer, Finder,
    /// or the desktop's configured file manager on Linux).
    fn open_directory(&self, path: &str) -> Result<(), String>;
    fn pick_file(&self, title: &str) -> Result<Option<String>, String>;
    fn pick_folder(&self, title: &str) -> Result<Option<String>, String>;
    /// Reads a text file inside one repository.
    ///
    /// `request` carries the repository and the path, separated by a newline.
    /// A file that is missing, binary, or larger than [`MAX_FILE_READ_BYTES`]
    /// is reported as absent rather than as an error: not being readable is a
    /// normal outcome for a working-tree entry.
    fn read_file(&self, request: &str) -> Result<Option<String>, String>;
    /// Fetches an HTTPS URL and returns its body as `"{content-type};base64,{data}"`,
    /// a generic, self-describing shape any caller can turn into a data URI or
    /// decode directly. A 404 is reported as `Ok(None)` — a normal "nothing at
    /// this URL" outcome, e.g. a Gravatar that does not exist — rather than an
    /// error; other failures (network, non-2xx, oversized body) are `Err`.
    fn fetch_url(&self, url: &str) -> Result<Option<String>, String>;
}

pub struct SystemOsBackend;

impl OsBackend for SystemOsBackend {
    fn read_clipboard(&self) -> Result<String, String> {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.get_text())
            .map_err(|error| error.to_string())
    }
    fn write_clipboard(&self, value: &str) -> Result<(), String> {
        arboard::Clipboard::new()
            .and_then(|mut clipboard| clipboard.set_text(value))
            .map_err(|error| error.to_string())
    }
    fn open_url(&self, value: &str) -> Result<(), String> {
        if !value.starts_with("https://")
            && !value.starts_with("http://")
            && !value.starts_with("mailto:")
        {
            return Err("unsupported external URL scheme".into());
        }
        open::that(value).map_err(|error| error.to_string())
    }
    fn open_directory(&self, path: &str) -> Result<(), String> {
        if !std::path::Path::new(path).is_dir() {
            return Err(format!("{path} is not a directory"));
        }
        open::that(path).map_err(|error| error.to_string())
    }
    fn pick_file(&self, title: &str) -> Result<Option<String>, String> {
        Ok(rfd::FileDialog::new()
            .set_title(title)
            .pick_file()
            .map(|path| path.to_string_lossy().into_owned()))
    }
    fn pick_folder(&self, title: &str) -> Result<Option<String>, String> {
        Ok(rfd::FileDialog::new()
            .set_title(title)
            .pick_folder()
            .map(|path| path.to_string_lossy().into_owned()))
    }
    fn read_file(&self, request: &str) -> Result<Option<String>, String> {
        let (repository, path) = request
            .split_once('\n')
            .ok_or_else(|| String::from("a file read names a repository and a path"))?;
        read_repository_file(std::path::Path::new(repository), path)
    }
    fn fetch_url(&self, url: &str) -> Result<Option<String>, String> {
        if !url.starts_with("https://") {
            return Err("only https URLs may be fetched".into());
        }
        // A Windows target's Rust toolchain here has no working C compiler for
        // rustls's usual ring backend, so this goes through native-tls
        // (Schannel) instead, built fresh per call rather than cached: it is
        // cheap local setup, not a network round trip.
        let connector =
            native_tls::TlsConnector::new().map_err(|error| error.to_string())?;
        let agent = ureq::builder()
            .tls_connector(std::sync::Arc::new(connector))
            .timeout(FETCH_TIMEOUT)
            .build();
        let response = match agent.get(url).call() {
            Ok(response) => response,
            Err(ureq::Error::Status(404, _)) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let content_type = response.content_type().to_string();
        let mut body = Vec::new();
        // One byte past the cap: reading exactly MAX_FETCH_BYTES would silently
        // truncate an oversized body into invalid, corrupt-looking data instead
        // of a clean error.
        response
            .into_reader()
            .take(MAX_FETCH_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|error| error.to_string())?;
        if body.len() as u64 > MAX_FETCH_BYTES {
            return Err(format!("response exceeds {MAX_FETCH_BYTES} bytes"));
        }
        Ok(Some(format!(
            "{content_type};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(body)
        )))
    }
}

/// Reads `path` only when it resolves inside `repository`.
///
/// The path arrives over the page boundary, so containment is checked against
/// the canonical repository rather than trusted; a path escaping it is an error,
/// while an unreadable file inside it is simply absent.
fn read_repository_file(
    repository: &std::path::Path,
    path: &str,
) -> Result<Option<String>, String> {
    let root = repository
        .canonicalize()
        .map_err(|error| format!("repository is unavailable: {error}"))?;
    let Ok(target) = root.join(path).canonicalize() else {
        return Ok(None);
    };
    if !target.starts_with(&root) {
        return Err("a file read may not leave its repository".into());
    }
    let Ok(metadata) = std::fs::metadata(&target) else {
        return Ok(None);
    };
    if !metadata.is_file() || metadata.len() > MAX_FILE_READ_BYTES {
        return Ok(None);
    }
    // Invalid UTF-8 means the file is not text the panel can show, which is the
    // same outcome as a file it cannot read.
    Ok(std::fs::read(&target).ok().and_then(|bytes| String::from_utf8(bytes).ok()))
}

pub struct OsModule {
    bus: Option<Bus>,
    backend: Arc<dyn OsBackend>,
}

impl OsModule {
    pub fn new(backend: Arc<dyn OsBackend>) -> Self {
        Self { bus: None, backend }
    }

    fn start(&self, request: OsRequest) {
        let Some(bus) = self.bus.clone() else { return };
        let backend = self.backend.clone();
        thread::spawn(move || {
            let result = execute(backend.as_ref(), &request);
            if let Ok(payload) = result.encode() {
                bus.publish(Envelope {
                    topic: RESULT_TOPIC.into(),
                    sender: "os".into(),
                    correlation: Some(u64::from(request.request_id)),
                    payload,
                });
            }
        });
    }
}

impl Default for OsModule {
    fn default() -> Self {
        Self::new(Arc::new(SystemOsBackend))
    }
}

impl Handler for OsModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic == REQUEST_TOPIC {
            if let Ok(request) = OsRequest::decode(&envelope.payload) {
                self.start(request);
            }
        } else if envelope.topic == PROMPT_RESPONSE_TOPIC {
            if let Ok(text) = std::str::from_utf8(&envelope.payload) {
                if let Some((id, value)) = text.split_once('\n') {
                    let _ = rendezvous::reply(&prompt_directory(), id, value);
                }
            }
        }
    }
}

impl Module for OsModule {
    fn name(&self) -> &str {
        "os"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        context.subscribe(PROMPT_RESPONSE_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }

    fn render(&mut self) {
        let Some(bus) = self.bus.as_ref() else { return };
        let Ok(entries) = std::fs::read_dir(prompt_directory()) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().is_some_and(|extension| extension == "request") {
                if let (Some(id), Ok(body)) = (path.file_stem().and_then(|value| value.to_str()), std::fs::read_to_string(&path)) {
                    let payload = format!("{id}\n{body}").into_bytes();
                    bus.publish(Envelope { topic: PROMPT_TOPIC.into(), sender: "os".into(), correlation: None, payload });
                }
            }
        }
    }
}

fn prompt_directory() -> std::path::PathBuf {
    std::env::current_exe().ok().and_then(|path| path.parent().map(|parent| parent.join("saves/prompts"))).unwrap_or_else(|| std::path::PathBuf::from("saves/prompts"))
}

fn execute(backend: &dyn OsBackend, request: &OsRequest) -> NativeResult {
    let outcome = match request.action {
        0 => backend.read_clipboard().map(Some),
        1 => backend
            .write_clipboard(&request.value)
            .map(|_| Some(String::new())),
        2 => backend
            .open_url(&request.value)
            .map(|_| Some(String::new())),
        3 => backend.pick_file(&request.value),
        4 => backend.pick_folder(&request.value),
        5 => backend.read_file(&request.value),
        6 => backend
            .open_directory(&request.value)
            .map(|_| Some(String::new())),
        7 => backend.fetch_url(&request.value),
        _ => Err("unknown OS action".into()),
    };
    match outcome {
        Ok(value) => NativeResult {
            request_id: request.request_id,
            accepted: value.is_some(),
            value: value.unwrap_or_default(),
            error: String::new(),
        },
        Err(error) => NativeResult {
            request_id: request.request_id,
            accepted: false,
            value: String::new(),
            error,
        },
    }
}

#[cfg(test)]
mod rendezvous_tests;
#[cfg(test)]
mod tests;
