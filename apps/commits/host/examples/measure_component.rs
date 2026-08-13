use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, Instant};

use bones_messages::web::PageMessage;
use bones_messages::{EncodeMessage, Message};
use bones_engine::bus::{BudgetLimits, Bus, EndpointBudget, Envelope, Handler, Registry, Respond};
use bones_engine::logging::Logger;
use bones_kernel::wasm_extensions::host::{new_engine, DisplayInfo, ExtensionTimeouts, Host};

const MESSAGE_COUNT: usize = 1_000;
/// Well past any plausible cold start or message handling, so a slow machine
/// reports a large number here instead of trapping and reporting none.
const MEASUREMENT_TIMEOUTS: ExtensionTimeouts = ExtensionTimeouts {
    load: Duration::from_secs(120),
    call: Duration::from_secs(120),
};

struct WebResponder;

impl Respond for WebResponder {
    fn respond(&self, _sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        Some(Vec::new())
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let component_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "dist/extensions/commits.wasm".to_string());
    let engine = new_engine()?;
    let bus = Bus::new();
    let registry = Registry::new();
    registry.insert("web", Arc::new(WebResponder));
    let started = Instant::now();
    let mut host = Host::load(
        &engine,
        &component_path,
        "commits",
        bus,
        registry,
        Logger::default(),
        Arc::new(AtomicBool::new(false)),
        DisplayInfo::default(),
        EndpointBudget::new(BudgetLimits::default()),
        // Generous on purpose: this run exists to measure the cold start, so
        // the budget must not cap the number it is trying to report.
        MEASUREMENT_TIMEOUTS,
    )?;
    let cold_start = started.elapsed();

    let payload = PageMessage {
        owner: "commits",
        panel: "main",
        json: r#"{"command":"echo","requestId":7,"value":"bones"}"#,
    }
    .encode();
    let envelope = Envelope {
        topic: PageMessage::TOPIC.to_string(),
        sender: "web".to_string(),
        correlation: None,
        payload,
    };
    let messages_started = Instant::now();
    for _ in 0..MESSAGE_COUNT {
        host.handle(&envelope);
    }
    let message_elapsed = messages_started.elapsed();

    let large_value = "x".repeat(1024 * 1024);
    let large_json = format!(r#"{{"command":"echo","requestId":8,"value":"{large_value}"}}"#);
    let large_envelope = Envelope {
        topic: PageMessage::TOPIC.to_string(),
        sender: "web".to_string(),
        correlation: None,
        payload: PageMessage {
            owner: "commits",
            panel: "main",
            json: &large_json,
        }
        .encode(),
    };
    let large_started = Instant::now();
    host.handle(&large_envelope);
    let large_elapsed = large_started.elapsed();
    let large_faulted = host.is_faulted();
    if !large_faulted {
        host.shutdown()?;
    }

    let size = std::fs::metadata(&component_path)?.len();
    println!("component_bytes={size}");
    println!("cold_start_ms={:.3}", cold_start.as_secs_f64() * 1_000.0);
    println!(
        "mean_message_us={:.3}",
        message_elapsed.as_secs_f64() * 1_000_000.0 / MESSAGE_COUNT as f64
    );
    println!(
        "one_mib_message_ms={:.3}",
        large_elapsed.as_secs_f64() * 1_000.0
    );
    println!("one_mib_message_faulted={large_faulted}");
    Ok(())
}
