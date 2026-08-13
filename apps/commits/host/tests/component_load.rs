use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use bones_engine::bus::{BudgetLimits, Bus, EndpointBudget, Registry, Respond};
use bones_engine::logging::Logger;
use bones_kernel::wasm_extensions::host::{new_engine, DisplayInfo, ExtensionTimeouts, Host};

/// The budgets `apps/commits/host/src/main.rs` gives the engine. Loading here
/// under the same allowances is the point of the test: the defaults are not
/// enough for a component this size (BUG-002, BUG-003), so a test that quietly
/// used different numbers would not be exercising what ships.
const TIMEOUTS: ExtensionTimeouts = ExtensionTimeouts {
    load: Duration::from_secs(30),
    call: Duration::from_secs(20),
};

struct WebResponder;

impl Respond for WebResponder {
    fn respond(&self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(Vec::new())
    }
}

struct PageResponder(Vec<u8>);

impl Respond for PageResponder {
    fn respond(&self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(self.0.clone())
    }
}

#[test]
fn generated_components_load_and_initialize_in_bones() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let engine = new_engine().unwrap();

    for name in ["hello", "commits"] {
        let registry = Registry::new();
        registry.insert("web", Arc::new(WebResponder));
        registry.insert(
            "page",
            Arc::new(PageResponder(b"http://127.0.0.1:32123/page.html".to_vec())),
        );
        let path = root.join(format!("dist/extensions/{name}.wasm"));
        let mut host = Host::load(
            &engine,
            path.to_str().unwrap(),
            name,
            Bus::new(),
            registry,
            Logger::default(),
            Arc::new(AtomicBool::new(false)),
            DisplayInfo::default(),
            EndpointBudget::new(BudgetLimits::default()),
            TIMEOUTS,
        )
        .unwrap();
        assert!(!host.is_faulted());
        host.shutdown().unwrap();
    }
}
