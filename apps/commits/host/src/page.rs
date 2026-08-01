use std::path::PathBuf;

use bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint name the component addresses with a direct `send`.
pub const ENDPOINT: &str = "page";

/// File served to the component, resolved next to the executable.
const PAGE_FILE: &str = "page.html";

/// Serves the standalone webview page from disk on demand.
///
/// The page is read at request time rather than compiled into the component so
/// rebuilding the page does not require rebuilding the WebAssembly component.
/// This also mirrors the VS Code extension, whose host supplies webview HTML at
/// runtime instead of embedding it.
#[derive(Default)]
pub struct PageModule;

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
        Ok(())
    }

    /// Answers a page request with the file's bytes, or an empty reply when it
    /// is missing so the component can report the failure itself.
    fn respond(&mut self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        let path = Self::resolve_page_path()?;
        Some(std::fs::read(path).unwrap_or_default())
    }
}
