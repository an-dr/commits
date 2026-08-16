use commits_os::OsBackend;

use crate::{
    download_asset_verified, fetch_manifest, is_installed_version_dir, is_newer, parse_manifest,
    shared_or_exe_relative, shared_or_exe_relative_from, verify_checksum, AppIdentity, Manifest,
};

/// Serializes tests that mutate the process-wide `COMMITS_INSTALL_DIR` env
/// var, which Rust's default parallel test execution would otherwise race.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serves fixed responses for `fetch_url`, so manifest/asset fetching can be
/// tested without a real network call. The other `OsBackend` methods are
/// unused here and simply error, matching commits-os's own StubBackend
/// pattern of only implementing what a given test suite exercises.
struct StubBackend {
    responses: std::collections::HashMap<String, Result<Option<String>, String>>,
}

impl OsBackend for StubBackend {
    fn read_clipboard(&self) -> Result<String, String> {
        Err("unused".into())
    }
    fn write_clipboard(&self, _value: &str) -> Result<(), String> {
        Err("unused".into())
    }
    fn open_url(&self, _value: &str) -> Result<(), String> {
        Err("unused".into())
    }
    fn open_directory(&self, _path: &str) -> Result<(), String> {
        Err("unused".into())
    }
    fn pick_file(&self, _title: &str) -> Result<Option<String>, String> {
        Err("unused".into())
    }
    fn pick_folder(&self, _title: &str) -> Result<Option<String>, String> {
        Err("unused".into())
    }
    fn read_file(&self, _request: &str) -> Result<Option<String>, String> {
        Err("unused".into())
    }
    fn fetch_url(&self, url: &str) -> Result<Option<String>, String> {
        self.responses
            .get(url)
            .cloned()
            .unwrap_or_else(|| Err(format!("no stub response for {url}")))
    }
    fn find_repositories(&self, _path: &str) -> Result<Option<String>, String> {
        Err("unused".into())
    }
}

fn stub_fetch_result(content_type: &str, bytes: &[u8]) -> String {
    use base64::Engine;
    format!(
        "{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[test]
fn parses_a_well_formed_manifest() {
    let manifest = parse_manifest(
        r#"{"version":"1.2.3","url":"https://example.com/app.zip","sha256":"abc123"}"#,
    )
    .unwrap();
    assert_eq!(
        manifest,
        Manifest {
            version: "1.2.3".into(),
            url: "https://example.com/app.zip".into(),
            sha256: Some("abc123".into()),
        }
    );
}

#[test]
fn treats_a_missing_checksum_as_optional() {
    let manifest =
        parse_manifest(r#"{"version":"1.0.0","url":"https://example.com/app.zip"}"#).unwrap();
    assert_eq!(manifest.sha256, None);
}

#[test]
fn rejects_a_manifest_missing_required_fields() {
    assert!(parse_manifest(r#"{"url":"https://example.com/app.zip"}"#).is_err());
    assert!(parse_manifest(r#"{"version":"1.0.0"}"#).is_err());
    assert!(parse_manifest("not json").is_err());
}

#[test]
fn compares_versions_numerically_not_lexically() {
    assert!(is_newer("1.2.0", "1.10.0"));
    assert!(!is_newer("1.10.0", "1.2.0"));
    assert!(is_newer("1.0.0", "1.0.1"));
    assert!(!is_newer("1.0.0", "1.0.0"));
    // Shorter version strings pad with zeros rather than comparing lexically.
    assert!(is_newer("1.0", "1.0.1"));
    assert!(!is_newer("1.0.1", "1.0"));
    // A malformed candidate never counts as an update.
    assert!(!is_newer("1.0.0", "not-a-version"));
    assert!(!is_newer("not-a-version", "1.0.0"));
}

#[test]
fn verifies_a_matching_checksum_case_insensitively() {
    let data = b"hello world";
    let expected = "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9";
    assert!(verify_checksum(data, expected));
    assert!(verify_checksum(data, &expected.to_uppercase()));
    assert!(!verify_checksum(data, "0000000000000000000000000000000000000000000000000000000000000000"));
}

#[test]
fn fetches_and_parses_a_manifest_through_the_backend() {
    let mut responses = std::collections::HashMap::new();
    responses.insert(
        "https://example.com/manifest.json".to_string(),
        Ok(Some(stub_fetch_result(
            "application/json",
            br#"{"version":"2.0.0","url":"https://example.com/app.zip"}"#,
        ))),
    );
    let backend = StubBackend { responses };

    let manifest = fetch_manifest(&backend, "https://example.com/manifest.json").unwrap();
    assert_eq!(manifest.version, "2.0.0");
    assert_eq!(manifest.url, "https://example.com/app.zip");
}

#[test]
fn download_asset_verified_rejects_a_checksum_mismatch() {
    let mut responses = std::collections::HashMap::new();
    responses.insert(
        "https://example.com/app.zip".to_string(),
        Ok(Some(stub_fetch_result("application/zip", b"payload bytes"))),
    );
    let backend = StubBackend { responses };
    let manifest = Manifest {
        version: "1.0.0".into(),
        url: "https://example.com/app.zip".into(),
        sha256: Some("0000000000000000000000000000000000000000000000000000000000000000".into()),
    };

    assert!(download_asset_verified(&backend, &manifest).is_err());
}

#[test]
fn download_asset_verified_accepts_a_matching_checksum() {
    let payload = b"payload bytes";
    let mut hasher = <sha2::Sha256 as sha2::Digest>::new();
    sha2::Digest::update(&mut hasher, payload);
    let digest = sha2::Digest::finalize(hasher);
    let hex = digest.iter().map(|b| format!("{b:02x}")).collect::<String>();

    let mut responses = std::collections::HashMap::new();
    responses.insert(
        "https://example.com/app.zip".to_string(),
        Ok(Some(stub_fetch_result("application/zip", payload))),
    );
    let backend = StubBackend { responses };
    let manifest = Manifest {
        version: "1.0.0".into(),
        url: "https://example.com/app.zip".into(),
        sha256: Some(hex),
    };

    assert_eq!(download_asset_verified(&backend, &manifest).unwrap(), payload);
}

#[test]
fn download_asset_verified_accepts_anything_when_no_checksum_is_published() {
    let mut responses = std::collections::HashMap::new();
    responses.insert(
        "https://example.com/app.zip".to_string(),
        Ok(Some(stub_fetch_result("application/zip", b"whatever"))),
    );
    let backend = StubBackend { responses };
    let manifest = Manifest {
        version: "1.0.0".into(),
        url: "https://example.com/app.zip".into(),
        sha256: None,
    };

    assert_eq!(download_asset_verified(&backend, &manifest).unwrap(), b"whatever");
}

/// Deliberately not this repository's own names: every path these tests
/// build comes from the identity, so a value left hardcoded in the code
/// under test fails here rather than passing by coincidence.
fn identity() -> AppIdentity {
    AppIdentity {
        install_dir_name: ".probe",
        install_env_var: "PROBE_INSTALL_DIR",
        launcher_stem: "probe",
        app_stem: "probe-app",
    }
}

fn running_exe_dir() -> std::path::PathBuf {
    std::env::current_exe().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn is_installed_version_dir_when_the_running_directory_is_a_child_of_the_install_dir() {
    let exe_dir = running_exe_dir();
    let install_dir = exe_dir.parent().unwrap();
    let _guard = ENV_LOCK.lock().unwrap();
    unsafe { std::env::set_var(identity().install_env_var, install_dir) };

    let installed = is_installed_version_dir(&identity(), &exe_dir);

    unsafe { std::env::remove_var(identity().install_env_var) };
    assert!(installed);
}

#[test]
fn not_an_installed_version_dir_when_the_install_dir_is_elsewhere() {
    let elsewhere = tempfile::tempdir().unwrap();
    let _guard = ENV_LOCK.lock().unwrap();
    unsafe { std::env::set_var(identity().install_env_var, elsewhere.path()) };

    let installed = is_installed_version_dir(&identity(), &running_exe_dir());

    unsafe { std::env::remove_var(identity().install_env_var) };
    assert!(!installed);
}

#[test]
fn shared_or_exe_relative_resolves_beside_the_real_running_exe() {
    // The test binary's own directory has no launcher beside it, so this
    // exercises the plain exe-relative fallback end to end through the
    // public function (current_exe() and all).
    let resolved = shared_or_exe_relative(&identity(), "state").unwrap();

    assert_eq!(resolved, running_exe_dir().join("state"));
}

#[test]
fn shared_or_exe_relative_from_stays_beside_the_exe_without_a_version_folder_shape() {
    let dir = tempfile::tempdir().unwrap();
    let exe_dir = dir.path().join("some-build");
    std::fs::create_dir_all(&exe_dir).unwrap();

    let resolved = shared_or_exe_relative_from(&identity(), &exe_dir, "state");

    assert_eq!(resolved, exe_dir.join("state"));
}

#[test]
fn shared_or_exe_relative_from_stays_beside_the_exe_without_a_launcher_sibling() {
    // A version-parseable folder name alone isn't enough -- without an
    // actual launcher next to it, this isn't a real install/build shape.
    let dir = tempfile::tempdir().unwrap();
    let exe_dir = dir.path().join("1.3.0");
    std::fs::create_dir_all(&exe_dir).unwrap();

    let resolved = shared_or_exe_relative_from(&identity(), &exe_dir, "state");

    assert_eq!(resolved, exe_dir.join("state"));
}

#[test]
fn shared_or_exe_relative_from_steps_up_when_running_from_a_version_folder() {
    // Purely structural: this is exactly the shape dist.ps1 assembles for a
    // plain build directory too, not only a real ~/.commits/app install.
    let dir = tempfile::tempdir().unwrap();
    let install_dir = dir.path().join("app");
    let exe_dir = install_dir.join("1.3.0");
    std::fs::create_dir_all(&exe_dir).unwrap();
    std::fs::write(install_dir.join(identity().launcher_exe()), b"launcher").unwrap();

    let resolved = shared_or_exe_relative_from(&identity(), &exe_dir, "state");

    assert_eq!(resolved, install_dir.join("state"));
}
