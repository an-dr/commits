use std::time::Duration;

use bones_kernel::bus::{Envelope, Handler, Module, ModuleContext};
use bones_kernel::Kernel;
use bones_test::App;

/// The budgets `apps/commits/host/src/main.rs` gives the engine. Loading here
/// under the same allowances is the point of the test: the defaults are not
/// enough for a component this size (BUG-002, BUG-003), so a test that quietly
/// used different numbers would not be exercising what ships.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

/// Stands in for a native endpoint the component sends to during `init`,
/// answering every direct send with the same bytes.
struct Endpoint {
    name: &'static str,
    reply: &'static [u8],
}

impl Handler for Endpoint {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for Endpoint {
    fn name(&self) -> &str {
        self.name
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }

    fn respond(&mut self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(self.reply.to_vec())
    }
}

#[test]
fn generated_components_load_and_initialize_in_bones() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");

    for name in ["hello", "commits"] {
        let saves = tempfile::tempdir().unwrap();
        let kernel = Kernel::new()
            .saves_dir(saves.path())
            .extension_load_timeout(LOAD_TIMEOUT)
            .extension_call_timeout(CALL_TIMEOUT)
            .module(Endpoint {
                name: "web",
                reply: b"",
            })
            .module(Endpoint {
                name: "page",
                reply: b"http://127.0.0.1:32123/page.html",
            });
        let app = App::with_kernel(kernel, root.join(format!("dist/extensions/{name}.wasm")))
            .unwrap_or_else(|error| panic!("{name} did not load: {error}"));
        assert!(app.is_running(), "{name} was quarantined:\n{}", app.logs().join("\n"));
    }
}
