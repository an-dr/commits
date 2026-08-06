use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::Duration;

use bus::{BudgetLimits, Bus, EndpointBudget, Registry, Respond};
use logging::Logger;
use wasm_extensions::host::{new_engine, DisplayInfo, Host};

/// The budget `apps/commits/host/src/main.rs` gives the engine. Loading here
/// under the same allowance is the point of the test: the default of one
/// second is not enough for a component this size (BUG-002), so a test that
/// quietly used a different number would not be exercising what ships.
const LOAD_TIMEOUT: Duration = Duration::from_secs(30);

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
            LOAD_TIMEOUT,
        )
        .unwrap();
        assert!(!host.is_faulted());
        host.shutdown().unwrap();
    }
}
