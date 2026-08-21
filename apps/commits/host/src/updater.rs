use std::path::Path;
use std::sync::Arc;

use bones_messages::persistence::{Save, ENDPOINT as PERSISTENCE_ENDPOINT};
use bones_messages::{EncodeMessage, Message};
use bones_engine::bus::{Bus, Envelope, Handler, Module, ModuleContext, Registry};
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

/// This module's own bus registration name -- also the `sender` stamped on
/// its persistence save/load calls (see [`UpdaterModule::record_version_and_check_update`]),
/// so its version marker lives at `state/updater.bin`
/// (`bones_kernel::wasm_extensions::persistence::Persistence`), distinct from any other
/// module's or extension's own save file, and with no directory of its own
/// to manage: `state/` already exists for exactly this purpose.
const MODULE_NAME: &str = "updater";

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
    registry: Option<Registry>,
    backend: Arc<dyn OsBackend>,
}

impl UpdaterModule {
    pub fn new(backend: Arc<dyn OsBackend>) -> Self {
        Self { bus: None, registry: None, backend }
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
                    sender: MODULE_NAME.into(),
                    correlation: Some(u64::from(request.request_id)),
                    payload,
                });
            }
        });
    }

    /// Compares `current` against the version last saved through bones'
    /// own `persistence` module (`state/updater.bin`), records `current`
    /// for next time, and returns whether this is the first start
    /// reporting a version different from the one last saved -- the signal
    /// [`encode_install_status`] uses to show a one-time "just updated"
    /// notice. A missing save (first run ever, or persistence unavailable)
    /// is not a change: there is nothing to announce yet, only something to
    /// start recording.
    ///
    /// The load is a direct, synchronous `send` (ADR-010) through the
    /// [`Registry`] service, so the answer reflects whatever was already on
    /// disk. The save is a `persistence/save` publish instead -- the same
    /// pub/sub, fire-and-forget path a WASM extension itself would use --
    /// which only takes effect on the engine's next `Bus::dispatch()`
    /// rather than immediately; that is fine here, since the load that
    /// matters is the *next start's*, well after this process has ticked
    /// many times over.
    fn record_version_and_check_update(&self, current: &str) -> bool {
        let previous = self.registry.as_ref().and_then(|registry| registry.call(MODULE_NAME, PERSISTENCE_ENDPOINT, &[]).ok());
        if let Some(bus) = &self.bus {
            bus.publish(Envelope {
                topic: Save::TOPIC.into(),
                sender: MODULE_NAME.into(),
                correlation: None,
                payload: Save { bytes: current.as_bytes() }.encode(),
            });
        }
        match previous {
            Some(bytes) if !bytes.is_empty() => bytes != current.as_bytes(),
            _ => false,
        }
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

/// Downloads and checksum-verifies the manifest's asset, then extracts it
/// into its own new version folder under the install dir -- the launcher
/// picks it up as current the next time it starts, simply because it is now
/// the newest version folder on disk.
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
    let install_dir = commits_upgrader::default_install_dir(&commits_upgrader::host_identity())
        .ok_or_else(|| String::from("could not resolve the install directory"))?;
    commits_upgrader::extract_version(&asset, &install_dir, &manifest.version)?;
    Ok(manifest.version)
}

/// Copies the running executable's own directory into a new version folder,
/// for a build not launched from the canonical install location: this
/// pushes what is already running into the same version-folder slot a
/// downloaded update would occupy -- unless nothing is installed there at
/// all yet, in which case there is no launcher present to ever pick up a
/// pushed version folder, so the files go directly to the install location
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
/// (`fresh`) rather than pushing a new version folder for an existing
/// launcher to pick up.
fn install_inner(source_dir: &Path) -> Result<bool, String> {
    if is_install_dir(source_dir) {
        // The Install menu entry is hidden once installed, so reaching this
        // means a direct call raced a rename/move of the install directory
        // out from under a running instance -- copying source_dir into
        // itself would be destructive, so refuse instead.
        return Err(String::from("this build is already the one installed; nothing to do"));
    }
    let identity = commits_upgrader::host_identity();
    let install_dir = commits_upgrader::default_install_dir(&identity)
        .ok_or_else(|| String::from("could not resolve the install directory"))?;
    if install_dir.join(identity.launcher_exe()).is_file() {
        commits_upgrader::copy_version_from_dir(&identity, source_dir, &install_dir, CURRENT_VERSION)?;
        Ok(false)
    } else {
        commits_upgrader::install_fresh(&identity, source_dir, &install_dir, CURRENT_VERSION)?;
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

/// Whether `current` is a version folder directly under the canonical
/// install location -- i.e. this run started as `commits.exe` (the
/// launcher) launching a version folder it picked, rather than a dev build
/// or an ad-hoc launch.
fn is_install_dir(current: &Path) -> bool {
    commits_upgrader::is_installed_version_dir(&commits_upgrader::host_identity(), current)
}

/// `[SUCCESS, installed_byte, just_updated_byte, ...version_utf8]` -- the
/// version trails unprefixed, as the last field, matching `commits-repo`'s
/// own rest-is-the-final-string convention.
///
/// `just_updated` only has meaning for an installed run -- a dev or ad-hoc
/// build was never "updated" by this mechanism -- so it skips
/// [`UpdaterModule::record_version_and_check_update`] entirely rather than
/// reporting `false` after saving anyway: a non-installed run has no
/// business recording a version marker at all.
fn encode_install_status(module: &UpdaterModule) -> Vec<u8> {
    let installed = is_installed();
    let just_updated = if installed { module.record_version_and_check_update(CURRENT_VERSION) } else { false };
    let mut response = vec![SUCCESS, u8::from(installed), u8::from(just_updated)];
    response.extend(CURRENT_VERSION.as_bytes());
    response
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
        MODULE_NAME
    }

    fn init(&mut self, context: &mut ModuleContext) -> Result<(), String> {
        context.subscribe(REQUEST_TOPIC);
        self.bus = context.get_service::<Bus>().cloned();
        self.registry = context.get_service::<Registry>().cloned();
        if self.bus.is_none() {
            return Err("no Bus service available".into());
        }
        if self.registry.is_none() {
            return Err("no Registry service available".into());
        }
        Ok(())
    }

    /// Synchronous "is this run installed, and what version is it?" query,
    /// answered directly rather than through the async request/completed
    /// path used by check/stage/install: both are local and instant --
    /// a path comparison and a compile-time constant -- so there is nothing
    /// to avoid blocking on.
    fn respond(&mut self, sender: &str, _payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return Some(encode_failure("install status is private to the commits component"));
        }
        Some(encode_install_status(self))
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};

    use bones_engine::bus::{Bus, ModuleRegistration, ServiceRegistry};
    use bones_kernel::wasm_extensions::persistence::Persistence;

    use super::*;

    /// Serializes tests that mutate the process-wide `COMMITS_INSTALL_DIR`
    /// env var, which Rust's default parallel test execution would
    /// otherwise race.
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
        fn find_repositories(&self, _path: &str) -> Result<Option<String>, String> { Err("unused".into()) }
        fn run_tool(&self, _request: &str) -> Result<(), String> { Err("unused".into()) }
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
        services.provide(Registry::new()).unwrap();
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
    fn stage_downloads_and_extracts_into_a_new_version_folder() {
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
        let install_dir = tempfile::tempdir().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", install_dir.path()) };

        let result = stage(&backend, 2, "https://example.com/manifest.json");

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(result.ok, "{}", result.error);
        assert_eq!(result.version, "1.5.0");
        assert!(install_dir.path().join("1.5.0").is_dir());
    }

    #[test]
    fn install_from_pushes_a_new_version_folder_when_a_launcher_is_already_installed() {
        let source_dir = tempfile::tempdir().unwrap();
        std::fs::write(source_dir.path().join("commits-app.exe"), b"a dev build").unwrap();
        let install_dir = tempfile::tempdir().unwrap();
        let launcher = commits_upgrader::host_identity().launcher_exe();
        std::fs::write(install_dir.path().join(&launcher), b"already installed").unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", install_dir.path()) };

        let result = install_from(source_dir.path(), 7);

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(result.ok, "{}", result.error);
        assert!(!result.fresh);
        assert_eq!(
            std::fs::read(install_dir.path().join(CURRENT_VERSION).join("commits-app.exe")).unwrap(),
            b"a dev build",
        );
        // The already-installed launcher itself is untouched -- only a new
        // version folder is pushed for it to pick up on its own next start.
        assert_eq!(
            std::fs::read(install_dir.path().join(&launcher)).unwrap(),
            b"already installed",
        );
    }

    #[test]
    fn install_from_places_files_directly_when_nothing_is_installed_yet() {
        let source_dir = tempfile::tempdir().unwrap();
        let launcher = commits_upgrader::host_identity().launcher_exe();
        std::fs::write(source_dir.path().join(&launcher), b"the launcher").unwrap();
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
        assert_eq!(std::fs::read(install_dir.join(&launcher)).unwrap(), b"the launcher");
        assert_eq!(
            std::fs::read(install_dir.join(CURRENT_VERSION).join("commits-app.exe")).unwrap(),
            b"a dev build",
        );
    }

    #[test]
    fn install_from_refuses_when_the_source_is_already_a_version_folder_under_the_install_dir() {
        let install_root = tempfile::tempdir().unwrap();
        let version_dir = install_root.path().join("1.0.0");
        std::fs::create_dir_all(&version_dir).unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", install_root.path()) };

        let result = install_from(&version_dir, 7);

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert!(!result.ok);
    }

    #[test]
    fn is_installed_when_the_running_directory_is_a_version_folder_under_the_install_dir() {
        let running_dir = running_directory().unwrap();
        let install_dir = running_dir.parent().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", install_dir) };

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
    fn respond_answers_the_trusted_sender_with_install_status_and_version() {
        // No init() here (mirroring how a plain UpdaterModule::default() is
        // never installed either): self.bus/self.registry stay None, so
        // record_version_and_check_update is a no-op even if is_installed()
        // somehow returned true on this machine.
        let mut module = UpdaterModule::default();

        let response = module.respond(OWNER, &[]).unwrap();

        assert_eq!(response[0], SUCCESS);
        assert!(response[1] == 0 || response[1] == 1);
        assert!(response[2] == 0 || response[2] == 1);
        assert_eq!(std::str::from_utf8(&response[3..]).unwrap(), CURRENT_VERSION);
    }

    /// Wires a real `Persistence` module (see `bones_kernel::wasm_extensions::persistence`)
    /// into `bus`/`registry` at `dir`, so `UpdaterModule`'s own
    /// `record_version_and_check_update` -- a `persistence/save` publish for
    /// save, a direct `send` to the `persistence` endpoint for load -- has
    /// somewhere real to round-trip through, the same as it would inside a
    /// full engine. The returned `ModuleRegistration` must be kept alive for
    /// as long as the endpoint needs to answer calls.
    fn attach_persistence(bus: &Bus, registry: &Registry, services: &mut ServiceRegistry, dir: &std::path::Path) -> ModuleRegistration {
        ModuleRegistration::attach(bus.clone(), registry.clone(), services, Persistence::new(dir, false)).unwrap()
    }

    #[test]
    fn respond_reports_just_updated_exactly_once_after_the_version_changes() {
        // just_updated is only ever recorded for an installed run, so this
        // needs COMMITS_INSTALL_DIR set to match the running directory too,
        // not just somewhere for persistence to save into.
        let state_dir = tempfile::tempdir().unwrap();
        let install_dir = running_directory().unwrap().parent().unwrap().to_path_buf();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", &install_dir) };

        let bus = Bus::new();
        let registry = Registry::new();
        let mut services = ServiceRegistry::new();
        services.provide(bus.clone()).unwrap();
        services.provide(registry.clone()).unwrap();
        let _persistence = attach_persistence(&bus, &registry, &mut services, state_dir.path());
        // Seeds a previous save so the first query below reports a change.
        bus.publish(Envelope {
            topic: Save::TOPIC.into(),
            sender: MODULE_NAME.into(),
            correlation: None,
            payload: Save { bytes: b"0.0.1" }.encode(),
        });
        bus.dispatch();
        let mut module = UpdaterModule::default();
        module.init(&mut ModuleContext::new(&mut services)).unwrap();

        let first = module.respond(OWNER, &[]).unwrap();
        bus.dispatch(); // flushes the save the first respond() call just queued
        let second = module.respond(OWNER, &[]).unwrap();

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert_eq!(first[2], 1, "the first response after a version change reports it");
        assert_eq!(second[2], 0, "a later response at the same version does not report it again");
    }

    #[test]
    fn respond_never_records_a_version_for_a_non_installed_run() {
        let state_dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let _guard = ENV_LOCK.lock().unwrap();
        unsafe { std::env::set_var("COMMITS_INSTALL_DIR", elsewhere.path()) };

        let bus = Bus::new();
        let registry = Registry::new();
        let mut services = ServiceRegistry::new();
        services.provide(bus.clone()).unwrap();
        services.provide(registry.clone()).unwrap();
        let _persistence = attach_persistence(&bus, &registry, &mut services, state_dir.path());
        let mut module = UpdaterModule::default();
        module.init(&mut ModuleContext::new(&mut services)).unwrap();

        let response = module.respond(OWNER, &[]).unwrap();
        bus.dispatch();

        unsafe { std::env::remove_var("COMMITS_INSTALL_DIR") };
        assert_eq!(response[1], 0, "not installed");
        assert_eq!(response[2], 0, "never just-updated when not installed");
        assert!(
            !state_dir.path().join("updater.bin").exists(),
            "a non-installed run must not save a version marker at all"
        );
    }
}
