use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use bus::{Bus, Envelope, Handler, Module, ModuleContext, ServiceRegistry};
use commits_proto::native::{GitResult, GitRun};

use crate::{GitModule, COMPLETED_TOPIC, REQUEST_TOPIC};

#[test]
fn schedules_without_blocking_and_publishes_a_correlated_result() {
    let bus = Bus::new();
    let mut services = ServiceRegistry::new();
    services.provide(bus.clone()).unwrap();
    let mut module = GitModule::new(2);
    module.init(&mut ModuleContext::new(&mut services)).unwrap();

    let received = Arc::new(Mutex::new(Vec::<Envelope>::new()));
    let output = received.clone();
    let endpoint = bus.register("test", move |envelope: &Envelope| {
        output.lock().unwrap().push(envelope.clone());
    });
    endpoint.subscribe(COMPLETED_TOPIC);
    let payload = GitRun {
        request_id: 12,
        cwd: env!("CARGO_MANIFEST_DIR").into(),
        args: vec!["--version".into()],
        env: Vec::new(),
        timeout_ms: 2_000,
    }
    .encode()
    .unwrap();

    let started = Instant::now();
    module.handle(&Envelope {
        topic: REQUEST_TOPIC.into(),
        sender: "test".into(),
        correlation: Some(12),
        payload,
    });
    assert!(started.elapsed() < Duration::from_millis(20));

    let deadline = Instant::now() + Duration::from_secs(3);
    while received.lock().unwrap().is_empty() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
        bus.dispatch();
    }
    let event = received.lock().unwrap().first().cloned().unwrap();
    assert_eq!(event.correlation, Some(12));
    let result = GitResult::decode(&event.payload).unwrap();
    assert_eq!(result.exit_code, 0);
}

#[test]
fn synchronous_version_query_is_bounded() {
    let mut module = GitModule::default();
    let result = GitResult::decode(&module.respond("test", &[0]).unwrap()).unwrap();
    assert_eq!(result.exit_code, 0);
    assert!(String::from_utf8_lossy(&result.stdout).starts_with("git version"));
}

#[test]
fn shutdown_cancels_every_active_job() {
    let mut module = GitModule::default();
    let first = Arc::new(AtomicBool::new(false));
    let second = Arc::new(AtomicBool::new(false));
    module
        .cancellations
        .lock()
        .unwrap()
        .insert(1, first.clone());
    module
        .cancellations
        .lock()
        .unwrap()
        .insert(2, second.clone());
    module.shutdown();
    assert!(first.load(Ordering::Acquire));
    assert!(second.load(Ordering::Acquire));
}
