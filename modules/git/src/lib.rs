use bus::{Envelope, Handler, Module, ModuleContext};

mod limiter;
pub mod process_runner;

pub struct GitModule;

impl Handler for GitModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

#[cfg(test)]
mod process_runner_tests;

impl Module for GitModule {
    fn name(&self) -> &str {
        "git"
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }
}
