use bus::{Envelope, Handler, Module, ModuleContext};

pub struct WatcherModule;

impl Handler for WatcherModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for WatcherModule {
    fn name(&self) -> &str {
        "watcher"
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
}
