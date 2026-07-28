use bus::{Envelope, Handler, Module, ModuleContext};

pub struct GitModule;

impl Handler for GitModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for GitModule {
    fn name(&self) -> &str {
        "git"
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
}
