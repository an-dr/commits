use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use bus::{BudgetLimits, Bus, EndpointBudget, Registry, Respond};
use logging::Logger;
use wasm_extensions::host::{new_engine, DisplayInfo, Host};

struct WebResponder;

impl Respond for WebResponder {
    fn respond(&self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(Vec::new())
    }
}

#[test]
fn generated_components_load_and_initialize_in_bones() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let engine = new_engine().unwrap();

    for name in ["hello", "commits"] {
        let registry = Registry::new();
        registry.insert("web", Arc::new(WebResponder));
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
        )
        .unwrap();
        assert!(!host.is_faulted());
        host.shutdown().unwrap();
    }
}
