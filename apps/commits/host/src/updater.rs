use std::path::Path;
use std::sync::Arc;

use bus::{Bus, Envelope, Handler, Module, ModuleContext};
use commits_ipc::native::{UpdaterRequest, UpdaterResult};
use commits_os::{OsBackend, SystemOsBackend};

pub const REQUEST_TOPIC: &str = "updater/request";
pub const COMPLETED_TOPIC: &str = "updater/completed";

const CHECK: u8 = 0;
const STAGE: u8 = 1;
const INSTALL: u8 = 2;

const OWNER: &str = "commits";
const SUCCESS: u8 = 0;
const FAILURE: u8 = 1;

/// This binary's own version, compared against a manifest's `version` field.
const CURRENT_VERSION: &str = env!("CARGO_PKG_VERSION");

/// Checks a hosted manifest for a newer version, stages a verified download
/// for the launcher to apply on next start, or -- for a build not running
/// from the canonical install location -- stages a copy of itself instead.
/// Also answers a synchronous "is this run installed?" query used to decide
/// whether the Install menu entry should show at all.
///
/// The async actions mirror `commits-git`'s request/completed pattern: each
/// request runs on its own thread and reports back over the bus rather than
/// blocking the engine's single-threaded tick, since a manifest fetch or an
/// asset download is a real network call with no bound tight enough to make
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
                INSTALL => install(request.request_id),
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
            fresh: false,
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
            fresh: false,
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

/// Stages a copy of the running executable's own directory, for a build not
/// launched from the canonical install location: there is nothing on disk
/// yet for a launcher to apply, so this pushes what is already running into
/// the same slot a downloaded update would occupy -- unless nothing is
/// installed there at all yet, in which case there is no launcher to ever
/// apply a staged update, so the files go directly to the install location
/// instead (see [`install_inner`]).
fn install(request_id: u32) -> UpdaterResult {
    match running_directory() {
        Ok(source_dir) => install_from(&source_dir, request_id),
        Err(error) => failed(request_id, error),
    }
}

/// Does the actual staging for [`install`], taking `source_dir` as a
/// parameter rather than resolving it internally: a test can then supply a
/// small directory instead of `current_exe()`'s real (and irrelevantly
/// large, being the test binary's own build output) directory.
fn install_from(source_dir: &Path, request_id: u32) -> UpdaterResult {
    match install_inner(source_dir) {
        Ok(fresh) => UpdaterResult {
            request_id,
            ok: true,
            available: true,
            fresh,
            version: String::new(),
            error: String::new(),
        },
        Err(error) => failed(request_id, error),
    }
}

/// Returns whether this placed files directly at the install location
/// (`fresh`) rather than staging them for an existing launcher to apply.
fn install_inner(source_dir: &Path) -> Result<bool, String> {
    if is_install_dir(source_dir) {
        // The Install menu entry is hidden once installed, so reaching this
        // means a direct call raced a rename/move of the install directory
        // out from under a running instance -- copying source_dir into
        // itself would be destructive, so refuse instead.
        return Err(String::from("this build is already the one installed; nothing to do"));
    }
    let install_dir = commits_upgrader::default_install_dir()
        .ok_or_else(|| String::from("could not resolve the install directory"))?;
    if install_dir.join(commits_upgrader::LAUNCHER_EXE_NAME).is_file() {
        let state_dir = commits_upgrader::state_dir()
            .ok_or_else(|| String::from("could not resolve the update state directory"))?;
        commits_upgrader::stage_current_install(source_dir, &state_dir.join("update"))?;
        Ok(false)
    } else {
        commits_upgrader::stage_current_install(source_dir, &install_dir)?;
        Ok(true)
    }
}

fn running_directory() -> Result<std::path::PathBuf, String> {
    std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(Path::to_path_buf))
        .ok_or_else(|| String::from("could not resolve the running executable's own directory"))
}

/// Whether this run's own directory is the canonical install location.
fn is_installed() -> bool {
    running_directory().map(|dir| is_install_dir(&dir)).unwrap_or(false)
}

/// Whether `current` is the canonical install location. Canonicalized
/// before comparing: a raw comparison can mismatch even for the same
/// directory (e.g. drive-letter casing or short/long name form). A
/// canonicalize failure on the install side (the ordinary case: nothing is
/// installed there yet) reads as "not installed" rather than an error.
fn is_install_dir(current: &Path) -> bool {
    let Ok(current) = current.canonicalize() else {
        return false;
    };
    let Some(install_dir) = commits_upgrader::default_install_dir().and_then(|dir| dir.canonicalize().ok()) else {
        return false;
    };
    current == install_dir
}

fn encode_install_status() -> Vec<u8> {
    vec![SUCCESS, u8::from(is_installed())]
}

fn encode_failure(message: &str) -> Vec<u8> {
    let mut response = Vec::with_capacity(message.len() + 1);
    response.push(FAILURE);
    response.extend(message.as_bytes());
    response
}

fn failed(request_id: u32, error: String) -> UpdaterResult {
    UpdaterResult {
        request_id,
        ok: false,
        available: false,
        fresh: false,
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

    /// Synchronous "is this run installed?" query, answered directly rather
    /// than through the async request/completed path used by check/stage/
    /// install: it is a local, instant path comparison, not a network call
    /// or a filesystem copy, so there is nothing to avoid blocking on.
    fn respond(&mut self, sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode_failure("install status is private to the commits component"));
        }
        Some(encode_install_status())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use bus::{Bus, ServiceRegistry};

    use super::*;

    /// Serializes tests that mutate the process-wide `COMMITS_UPDATER_DIR`
    /// and `COMMITS_INSTALL_DIR` env vars, which Rust's default parallel
    /// test execution would otherwise race.
    static ENV_LOCK: Mutex<()> = Mutex::new(());

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
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_UPDATER_DIR", state_dir.path()) };

        let result = stage(&backend, 2, "https://example.com/manifest.json");

        unsafe { std::env::remove_var("COMMITS_UPDATER_DIR") };
        assert!(result.ok, "{}", result.error);
        assert_eq!(result.version, "1.5.0");
        assert!(state_dir.path().join("update").is_dir());
    }

    #[test]
    fn install_from_stages_as_an_update_when_a_launcher_is_already_installed() {
        let source_dir = tempfile::tempdir().unwrap();
        std::fs::write(source_dir.path().join("commits-app.exe"), b"a dev build").unwrap();
        let install_dir = tempfile::tempdir().unwrap();
        std::fs::write(install_dir.path().join(commits_upgrader::LAUNCHER_EXE_NAME), b"already installed").unwrap();
        let state_dir = tempfile::tempdir().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe {
            std::env::set_var("COMMITS_INSTALL_DIR", install_dir.path());
            std::env::set_var("COMMITS_UPDATER_DIR", state_dir.path());
        }

        let result = install_from(source_dir.path(), 7);

        unsafe {
            std::env::remove_var("COMMITS_INSTALL_DIR");
            std::env::remove_var("COMMITS_UPDATER_DIR");
        }
        assert!(result.ok, "{}", result.error);
        assert!(!result.fresh);
        assert_eq!(
            std::fs::read(state_dir.path().join("update/commits-app.exe")).unwrap(),
            b"a dev build",
        );
        // The already-installed launcher itself is untouched -- only staged
        // for it to apply on its own next start.
        assert_eq!(
            std::fs::read(install_dir.path().join(commits_upgrader::LAUNCHER_EXE_NAME)).unwrap(),
            b"already installed",
        );
    }

    #[test]
    fn install_from_places_files_directly_when_nothing_is_installed_yet() {
        let source_dir = tempfile::tempdir().unwrap();
        std::fs::write(source_dir.path().join("commits-app.exe"), b"a dev build").unwrap();
        let install_root = tempfile::tempdir().unwrap();
        let install_dir = install_root.path().join("app");
        assert!(!install_dir.exists());
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", &install_dir) };

        let result = install_from(source_dir.path(), 7);

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(result.ok, "{}", result.error);
        assert!(result.fresh);
        assert_eq!(std::fs::read(install_dir.join("commits-app.exe")).unwrap(), b"a dev build");
    }

    #[test]
    fn install_from_refuses_when_the_source_is_already_the_install_dir() {
        let source_dir = tempfile::tempdir().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", source_dir.path()) };

        let result = install_from(source_dir.path(), 7);

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(!result.ok);
    }

    #[test]
    fn is_installed_when_the_configured_install_dir_matches_the_running_directory() {
        let running_dir = running_directory().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", &running_dir) };

        let installed = is_installed();

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(installed);
    }

    #[test]
    fn not_installed_when_the_configured_install_dir_is_elsewhere() {
        let elsewhere = tempfile::tempdir().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", elsewhere.path()) };

        let installed = is_installed();

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(!installed);
    }

    #[test]
    fn respond_rejects_a_sender_other_than_the_commits_component() {
        let mut module = UpdaterModule::default();

        let response = module.respond("other", &[]).unwrap();

        assert_eq!(response[0], FAILURE);
    }

    #[test]
    fn respond_answers_the_trusted_sender_with_install_status() {
        let mut module = UpdaterModule::default();

        let response = module.respond(OWNER, &[]).unwrap();

        assert_eq!(response[0], SUCCESS);
        assert!(response[1] == 0 || response[1] == 1);
    }
}
