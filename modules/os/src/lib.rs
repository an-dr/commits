use bus::{Envelope, Handler, Module, ModuleContext};

pub struct OsModule;

impl Handler for OsModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for OsModule {
    fn name(&self) -> &str {
        "os"
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
}
