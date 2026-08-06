use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bus::{Envelope, Handler, Module, ModuleContext};
use logging::Logger;

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

fn serve(listener: TcpListener, page_path: PathBuf, shutdown: Arc<AtomicBool>) {
    while !shutdown.load(Ordering::Relaxed) {
        match listener.accept() {
            Ok((mut stream, _)) => respond_http(&mut stream, &page_path),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(_) => break,
        }
    }
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
    use super::{Module, PageModule, LOADING_REQUEST};

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

    #[test]
    fn before_the_server_is_listening_the_answer_is_empty_not_a_broken_url() {
        let answer = PageModule::default()
            .respond("splash", &[LOADING_REQUEST])
            .unwrap();

        assert!(answer.is_empty());
    }
}
