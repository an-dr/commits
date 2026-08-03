use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint name the component addresses with a direct `send`.
pub const ENDPOINT: &str = "page";

/// File served to the webview, resolved next to the executable.
const PAGE_FILE: &str = "page.html";

/// Resolves the standalone webview page on demand.
///
/// The page is served at request time rather than compiled into the component so
/// rebuilding the page does not require rebuilding the WebAssembly component.
/// This also mirrors the VS Code extension, whose host supplies webview HTML at
/// runtime instead of embedding it.
pub struct PageModule {
    url: Option<String>,
    shutdown: Arc<AtomicBool>,
}

impl Default for PageModule {
    fn default() -> Self {
        Self {
            url: None,
            shutdown: Arc::new(AtomicBool::new(false)),
        }
    }
}

impl PageModule {
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

        let shutdown = Arc::clone(&self.shutdown);
        std::thread::Builder::new()
            .name("commits-page-server".to_string())
            .spawn(move || serve(listener, path, shutdown))
            .map_err(|error| format!("starting page server: {error}"))?;
        Ok(())
    }

    /// Answers a page request with a local URL. Keeping the page bytes out of
    /// the interpreted WASM boundary makes startup effectively constant-size.
    fn respond(&mut self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(self.url.as_deref().unwrap_or_default().as_bytes().to_vec())
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
    let is_page = request[..read].starts_with(format!("GET /{PAGE_FILE} ").as_bytes());
    let (status, content_type, body) = if is_page {
        match std::fs::read(page_path) {
            Ok(page) => ("200 OK", "text/html; charset=utf-8", page),
            Err(_) => (
                "404 Not Found",
                "text/plain; charset=utf-8",
                b"Page not found".to_vec(),
            ),
        }
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
