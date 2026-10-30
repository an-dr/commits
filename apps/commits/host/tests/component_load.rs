use std::time::Duration;

use bones_kernel::Kernel;
use bones_test::{App, Stub};

/// The budgets `apps/commits/host/src/main.rs` gives the engine. Loading here
/// under the same allowances is the point of the test: the defaults are not
/// enough for a component this size (BUG-002, BUG-003), so a test that quietly
/// used different numbers would not be exercising what ships.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);
const CALL_TIMEOUT: Duration = Duration::from_secs(20);

#[test]
fn generated_component_loads_and_initializes_in_bones() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let saves = tempfile::tempdir().unwrap();
    let kernel = Kernel::new()
        .saves_dir(saves.path())
        .extension_load_timeout(LOAD_TIMEOUT)
        .extension_call_timeout(CALL_TIMEOUT)
        // Endpoints the component sends to during `init`.
        .module(Stub::new("web"))
        .module(Stub::new("page").reply(b"http://127.0.0.1:32123/page.html".to_vec()));
    let app = App::with_kernel(kernel, root.join("dist/extensions/commits.wasm"))
        .unwrap_or_else(|error| panic!("commits did not load: {error}"));
    assert!(app.is_running(), "commits was quarantined:\n{}", app.logs().join("\n"));
}
