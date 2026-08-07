use std::sync::Arc;

use bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{UpdaterRequest, UpdaterResult};
use commits_os::{OsBackend, SystemOsBackend};

pub const REQUEST_TOPIC: &str = "updater/request";
pub const COMPLETED_TOPIC: &str = "updater/completed";

const CHECK: u8 = 0;
const STAGE: u8 = 1;

/// This binary's own version, compared against a manifest's `version` field.
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Checks a hosted manifest for a newer version, and stages a verified
/// download for the launcher to apply on next start.
///
/// Mirrors `commits-git`'s request/completed pattern: each request runs on
/// its own thread and reports back over the bus rather than blocking the
/// engine's single-threaded tick, since both a manifest fetch and an asset
/// download are real network calls with no bound tight enough to make
/// synchronously. Takes an [`OsBackend`] the same way `OsModule` does, so a
/// test can inject a stub instead of hitting the network.
pub struct UpdaterModule {
    bus: Option<Bus>,
    backend: Arc<dyn OsBackend>,
}

impl UpdaterModule {
    pub fn new(backend: Arc<dyn OsBackend>) -> Self {
        Self { bus: None, backend }
    }

    fn start(&self, request: UpdaterRequest) {
        let Some(bus) = self.bus.clone() else {
            return;
        };
        let backend = self.backend.clone();
        std::thread::spawn(move || {
            let result = match request.action {
                CHECK => check(backend.as_ref(), request.request_id, &request.manifest_url),
                STAGE => stage(backend.as_ref(), request.request_id, &request.manifest_url),
                _ => return,
            };
            if let Ok(payload) = result.encode() {
                bus.publish(Envelope {
                    topic: COMPLETED_TOPIC.into(),
                    sender: "updater".into(),
                    correlation: Some(u64::from(request.request_id)),
                    payload,
                });
            }
        });
    }
}

fn check(backend: &dyn OsBackend, request_id: u32, manifest_url: &str) -> UpdaterResult {
    match commits_upgrader::fetch_manifest(backend, manifest_url) {
        Ok(manifest) => UpdaterResult {
            request_id,
            ok: true,
            available: commits_upgrader::is_newer(CURRENT_VERSION, &manifest.version),
            version: manifest.version,
            error: String::new(),
        },
        Err(error) => failed(request_id, error),
    }
}

/// Downloads and checksum-verifies the manifest's asset, then stages it into
/// the same directory the launcher applies from on next start.
fn stage(backend: &dyn OsBackend, request_id: u32, manifest_url: &str) -> UpdaterResult {
    match stage_inner(backend, manifest_url) {
        Ok(version) => UpdaterResult {
            request_id,
            ok: true,
            available: true,
            version,
            error: String::new(),
        },
        Err(error) => failed(request_id, error),
    }
}

fn stage_inner(backend: &dyn OsBackend, manifest_url: &str) -> Result<String, String> {
    let manifest = commits_upgrader::fetch_manifest(backend, manifest_url)?;
    let asset = commits_upgrader::download_asset_verified(backend, &manifest)?;
    let state_dir = commits_upgrader::state_dir()
        .ok_or_else(|| String::from("could not resolve the update state directory"))?;
    commits_upgrader::stage_update(&asset, &state_dir.join("update"))?;
    Ok(manifest.version)
}

fn failed(request_id: u32, error: String) -> UpdaterResult {
    UpdaterResult {
        request_id,
        ok: false,
        available: false,
        version: String::new(),
        error,
    }
}

impl Default for UpdaterModule {
    fn default() -> Self {
        Self::new(Arc::new(SystemOsBackend))
    }
}

impl Handler for UpdaterModule {
    fn handle(&mut self, envelope: &Envelope) {
        if envelope.topic != REQUEST_TOPIC {
            return;
        }
        if let Ok(request) = UpdaterRequest::decode(&envelope.payload) {
            self.start(request);
        }
    }
}

impl Module for UpdaterModule {
    fn name(&self) -> &str {
        "updater"
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.bus
            .as_ref()
            .map(|_| ())
            .ok_or_else(|| "no Bus service available".into())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use bus::{Bus, ServiceRegistry};

    use super::*;

    /// Serves fixed `fetch_url` responses, matching `commits-upgrader`'s own
    /// `StubBackend` test pattern; the other `OsBackend` methods are unused
    /// here.
    struct StubBackend {
        responses: HashMap<String, Result<Option<String>, String>>,
    }

    impl OsBackend for StubBackend {
        fn read_clipboard(&self) -> Result<String, String> { Err("unused".into()) }
        fn write_clipboard(&self, _value: &str) -> Result<(), String> { Err("unused".into()) }
        fn open_url(&self, _value: &str) -> Result<(), String> { Err("unused".into()) }
        fn open_directory(&self, _path: &str) -> Result<(), String> { Err("unused".into()) }
        fn pick_file(&self, _title: &str) -> Result<Option<String>, String> { Err("unused".into()) }
        fn pick_folder(&self, _title: &str) -> Result<Option<String>, String> { Err("unused".into()) }
        fn read_file(&self, _request: &str) -> Result<Option<String>, String> { Err("unused".into()) }
        fn fetch_url(&self, url: &str) -> Result<Option<String>, String> {
            self.responses.get(url).cloned().unwrap_or_else(|| Err(format!("no stub response for {url}")))
        }
    }

    fn stub_fetch_result(content_type: &str, bytes: &[u8]) -> String {
        use base64::Engine;
        format!("{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes))
    }

    fn manifest_response(version: &str) -> String {
        stub_fetch_result(
            "application/json",
            format!(r#"{{"version":"{version}","url":"https://example.com/app.zip"}}"#).as_bytes(),
        )
    }

    #[test]
    fn schedules_a_check_without_blocking_and_publishes_a_correlated_result() {
        let mut responses = HashMap::new();
        responses.insert("https://example.com/manifest.json".to_string(), Ok(Some(manifest_response("999.0.0"))));
        let bus = Bus::new();
        let mut services = ServiceRegistry::new();
        services.provide(bus.clone()).unwrap();
        let mut module = UpdaterModule::new(Arc::new(StubBackend { responses }));
        module.init(&mut ModuleContext::new(&mut services)).unwrap();

        let received = Arc::new(Mutex::new(Vec::<Envelope>::new()));
        let output = received.clone();
        let endpoint = bus.register("test", move |envelope: &Envelope| {
            output.lock().unwrap().push(envelope.clone());
        });
        endpoint.subscribe(COMPLETED_TOPIC);
        let payload = UpdaterRequest {
            request_id: 5,
            action: CHECK,
            manifest_url: "https://example.com/manifest.json".into(),
        }
        .encode()
        .unwrap();

        let started = Instant::now();
        module.handle(&Envelope { topic: REQUEST_TOPIC.into(), sender: "test".into(), correlation: None, payload });
        assert!(started.elapsed() < Duration::from_millis(20));

        let deadline = Instant::now() + Duration::from_secs(3);
        while received.lock().unwrap().is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
            bus.dispatch();
        }
        let event = received.lock().unwrap().first().cloned().unwrap();
        assert_eq!(event.correlation, Some(5));
        let result = UpdaterResult::decode(&event.payload).unwrap();
        assert!(result.ok);
        assert!(result.available);
        assert_eq!(result.version, "999.0.0");
    }

    #[test]
    fn check_reports_no_update_available_for_a_version_no_newer_than_current() {
        let mut responses = HashMap::new();
        responses.insert("https://example.com/manifest.json".to_string(), Ok(Some(manifest_response("0.0.1"))));
        let backend = StubBackend { responses };

        let result = check(&backend, 1, "https://example.com/manifest.json");

        assert!(result.ok);
        assert!(!result.available);
    }

    #[test]
    fn check_reports_failure_for_an_unreachable_manifest() {
        let backend = StubBackend { responses: HashMap::new() };

        let result = check(&backend, 1, "https://example.com/missing.json");

        assert!(!result.ok);
        assert!(!result.error.is_empty());
    }

    #[test]
    fn stage_downloads_and_extracts_into_the_configured_state_directory() {
        // An empty ZIP archive is exactly its 22-byte end-of-central-directory
        // record -- enough to exercise staging without a `zip` dev-dependency
        // just for building a test fixture.
        const EMPTY_ZIP: [u8; 22] = [
            0x50, 0x4B, 0x05, 0x06, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        ];
        let mut responses = HashMap::new();
        responses.insert("https://example.com/manifest.json".to_string(), Ok(Some(manifest_response("1.5.0"))));
        responses.insert("https://example.com/app.zip".to_string(), Ok(Some(stub_fetch_result("application/zip", &EMPTY_ZIP))));
        let backend = StubBackend { responses };
        let state_dir = tempfile::tempdir().unwrap();
        // SAFETY: this process's test binary has no other test touching
        // COMMITS_UPDATER_DIR, so there is no cross-test race.
        unsafe { std::env::set_var("COMMITS_UPDATER_DIR", state_dir.path()) };

        let result = stage(&backend, 2, "https://example.com/manifest.json");

        unsafe { std::env::remove_var("COMMITS_UPDATER_DIR") };
        assert!(result.ok, "{}", result.error);
        assert_eq!(result.version, "1.5.0");
        assert!(state_dir.path().join("update").is_dir());
    }
}
