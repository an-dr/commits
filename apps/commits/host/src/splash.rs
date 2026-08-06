//! Holds the window with a loading page until the real panel is ready.
//!
//! The window itself opens in about a second, but the component behind it is
//! ~12 MB carrying an embedded JavaScript engine and needs several more to
//! instantiate and run `init`. Nothing owned that gap, so it showed as a black
//! rectangle that looked like a failed launch.
//!
//! Native modules register before any extension attaches, which is what makes
//! this possible at all: this one claims a panel of its own while the
//! component is still compiling. Panels are keyed by `(owner, panel)`, so the
//! component's panel is a separate child webview created later -- later means
//! on top -- and this one is closed once it reports itself open.

use bones_messages::web::{ClosePanel, Command, OpenPanel, PanelOpened, PanelSource};
use bones_messages::{DecodeMessage, Message};
use bus::{Envelope, Handler, Module, ModuleContext, Registry};
use logging::Logger;

/// Bus endpoint name, and so the panel owner the web module records.
pub const ENDPOINT: &str = "splash";
/// Direct-send endpoint of the native web module.
const WEB: &str = "web";
const PANEL: &str = "loading";
/// The panel this one stands in for. Its arrival is the end of the wait.
const REPLACES: (&str, &str) = ("commits", "main");

/// Markup of the loading page. Served by [`crate::page`], which owns the only
/// thread that can answer while the main one is loading the component.
pub const LOADING_PAGE: &str = include_str!("splash.html");

#[derive(Default)]
pub struct SplashModule {
    /// Absent in a build without the web module, where there is no panel to
    /// open and nothing for this module to do.
    web: Option<Registry>,
    logger: Option<Logger>,
    shown: bool,
}

impl SplashModule {
    pub fn new(logger: Logger) -> Self {
        Self {
            logger: Some(logger),
            ..Self::default()
        }
    }

    /// Bookends the otherwise silent stretch of the log: everything between
    /// these two lines is the component loading.
    fn log(&self, message: &str) {
        if let Some(logger) = &self.logger {
            logger.info(ENDPOINT, message);
        }
    }

    fn show(&mut self) {
        let Some(registry) = &self.web else {
            return;
        };
        // Served over HTTP rather than handed over as markup. `PanelSource::
        // Html` goes through a per-panel custom protocol whose handler runs on
        // the thread that owns the window -- the thread that is busy loading
        // the component -- so the request goes unanswered for the whole wait
        // and the panel stays an empty white rectangle. The page server has
        // its own thread and answers regardless. (A `data:` URL renders, but
        // leaves the page at an opaque origin, where wry panics outright on
        // any `window.ipc` call.)
        let url = match registry.call(ENDPOINT, crate::page::ENDPOINT, &[crate::page::LOADING_REQUEST]) {
            Ok(url) => String::from_utf8_lossy(&url).into_owned(),
            Err(_) => return,
        };
        if url.is_empty() {
            return;
        }
        let command = Command::Open(OpenPanel {
            panel: PANEL,
            source: PanelSource::Url(&url),
        });
        // A failure here costs the loading page, not the launch: the
        // component still loads and still opens the real panel.
        self.shown = registry.call(ENDPOINT, WEB, &command.encode()).is_ok();
        match self.shown {
            true => self.log(&format!("loading page shown at {url}")),
            false => self.log("could not show the loading page"),
        }
    }

    fn hide(&mut self) {
        let Some(registry) = &self.web else {
            return;
        };
        let command = Command::Close(ClosePanel { panel: PANEL });
        let _ = registry.call(ENDPOINT, WEB, &command.encode());
        self.shown = false;
        self.log("loading page closed");
    }
}

impl Handler for SplashModule {
    fn handle(&mut self, envelope: &Envelope) {
        if !self.shown || envelope.topic != PanelOpened::TOPIC {
            return;
        }
        let Ok(opened) = PanelOpened::decode(&envelope.payload) else {
            return;
        };
        // Every panel reports here, this module's own included.
        if (opened.owner, opened.panel) != REPLACES {
            return;
        }
        self.hide();
    }
}

impl Module for SplashModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(PanelOpened::TOPIC);
        self.web = context.get_service::<Registry>().cloned();
        self.show();
        Ok(())
    }

    /// Covers the launch that never reaches a real panel -- a component that
    /// fails to load leaves this page up, and a stale "Starting up" reads as a
    /// hang rather than the failure the dialog is reporting.
    fn shutdown(&mut self) {
        if self.shown {
            self.hide();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{Envelope, Handler, Module, PanelOpened, SplashModule};
    use bones_messages::{EncodeMessage, Message};

    fn opened(owner: &str, panel: &str) -> Envelope {
        Envelope {
            topic: PanelOpened::TOPIC.to_string(),
            sender: "web".to_string(),
            correlation: None,
            payload: PanelOpened { owner, panel }.encode(),
        }
    }

    #[test]
    fn without_a_web_module_there_is_nothing_to_show_and_nothing_breaks() {
        let mut splash = SplashModule::default();

        splash.show();
        splash.handle(&opened("commits", "main"));

        assert!(!splash.shown);
    }

    #[test]
    fn only_the_panel_it_stands_in_for_takes_the_window() {
        let mut splash = SplashModule {
            shown: true,
            ..SplashModule::default()
        };

        splash.handle(&opened("commits", "other"));
        assert!(splash.shown, "another panel of the same owner is not the one");

        splash.handle(&opened("splash", "loading"));
        assert!(splash.shown, "its own panel opening must not dismiss it");
    }

    #[test]
    fn the_endpoint_name_is_the_panel_owner() {
        assert_eq!(SplashModule::default().name(), super::ENDPOINT);
    }
}
