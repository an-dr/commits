//! The self-update mechanism (crate name "upgrader", not "updater" — see
//! Cargo.toml for why).

use commits_os::OsBackend;
use sha2::{Digest, Sha256};

mod stage;
mod supervise;
mod versions;
pub use stage::{apply, restore_backup, stage as stage_update, stage_current_install};
pub use supervise::wait_for_marker;
pub use versions::{current_version_dir, previous_version_dir};

/// A hosted update announcement: the newest available version, where to
/// download it, and an optional integrity check. Checksum is optional
/// because not every manifest publisher can commit to one immediately, not
/// because it is unimportant — `download_asset_verified` refuses to accept
/// a mismatch when one is supplied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Manifest {
    pub version: String,
    pub url: String,
    pub sha256: Option<String>,
}

/// Parses a manifest from its JSON body. Manual field extraction rather than
/// `serde`'s derive macros, matching this workspace's existing
/// `serde_json::Value` convention (no other crate here pulls in `serde`
/// derive).
pub fn parse_manifest(body: &str) -> Result<Manifest, String> {
    let value: serde_json::Value =
        serde_json::from_str(body).map_err(|error| error.to_string())?;
    let version = value
        .get("version")
        .and_then(|v| v.as_str())
        .ok_or_else(|| String::from("manifest is missing a string \"version\""))?
        .to_string();
    let url = value
        .get("url")
        .and_then(|v| v.as_str())
        .ok_or_else(|| String::from("manifest is missing a string \"url\""))?
        .to_string();
    let sha256 = value
        .get("sha256")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Ok(Manifest { version, url, sha256 })
}

/// Compares dot-separated numeric versions ("1.12.0" vs "1.2.0"), padding
/// the shorter with zeros rather than comparing lexically, so "1.2" reads as
/// older than "1.10". A version with any non-numeric segment sorts as
/// smaller than any well-formed one, so a malformed candidate is never
/// mistaken for an update.
pub fn is_newer(current: &str, candidate: &str) -> bool {
    match (versions::parse_version_segments(current), versions::parse_version_segments(candidate)) {
        (Some(current), Some(candidate)) => {
            versions::compare_segments(&candidate, &current) == std::cmp::Ordering::Greater
        }
        _ => false,
    }
}

/// Fetches and parses the manifest at `url`. Takes the backend as a
/// trait object so a test can inject a stub instead of hitting the network,
/// the same pattern `commits-os` itself already tests with.
pub fn fetch_manifest(backend: &dyn OsBackend, url: &str) -> Result<Manifest, String> {
    let fetched = backend
        .fetch_url(url)?
        .ok_or_else(|| format!("no manifest found at {url}"))?;
    let (_, bytes) = commits_os::decode_fetch_result(&fetched)?;
    let body = String::from_utf8(bytes).map_err(|error| error.to_string())?;
    parse_manifest(&body)
}

/// Downloads the asset a manifest points at, refusing it outright if a
/// supplied checksum does not match — a truncated or tampered download is
/// treated identically to a network failure, never silently accepted.
pub fn download_asset_verified(backend: &dyn OsBackend, manifest: &Manifest) -> Result<Vec<u8>, String> {
    let fetched = backend
        .fetch_url(&manifest.url)?
        .ok_or_else(|| format!("no asset found at {}", manifest.url))?;
    let (_, bytes) = commits_os::decode_fetch_result(&fetched)?;
    if let Some(expected) = &manifest.sha256 {
        if !verify_checksum(&bytes, expected) {
            return Err(String::from("downloaded asset does not match the manifest's sha256"));
        }
    }
    Ok(bytes)
}

/// Where staged updates and backups live: `COMMITS_UPDATER_DIR` if set
/// (tests and support diagnostics), otherwise `~/.commits/updater`. Shared by
/// every process that needs to agree on this location -- the launcher
/// applies from it, and the running app stages into it -- so it is a single
/// function rather than each caller re-deriving the same path.
pub fn state_dir() -> Option<std::path::PathBuf> {
    if let Ok(value) = std::env::var("COMMITS_UPDATER_DIR") {
        return Some(std::path::PathBuf::from(value));
    }
    dirs::home_dir().map(|home| home.join(".commits").join("updater"))
}

/// Where a permanent install lives: `COMMITS_INSTALL_DIR` if set (tests),
/// otherwise `~/.commits/app`. Compared against the running process's own
/// directory to tell an installed run from a dev or ad-hoc one -- the Install
/// menu action only makes sense for the latter.
pub fn default_install_dir() -> Option<std::path::PathBuf> {
    if let Ok(value) = std::env::var("COMMITS_INSTALL_DIR") {
        return Some(std::path::PathBuf::from(value));
    }
    dirs::home_dir().map(|home| home.join(".commits").join("app"))
}

/// Compares `current` against the version last recorded in `state_dir()`,
/// records `current` for next time, and returns whether this is the first
/// start reporting a version different from the one last recorded -- the
/// signal a caller uses to show a one-time "just updated" notice. A missing
/// record (first run ever on this machine) is not a change: there is
/// nothing to announce yet, only something to start recording.
pub fn record_version_and_check_update(current: &str) -> Result<bool, String> {
    let path = state_dir()
        .ok_or_else(|| String::from("could not resolve the update state directory"))?
        .join("version");
    let previous = std::fs::read_to_string(&path).ok();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    std::fs::write(&path, current).map_err(|error| error.to_string())?;
    Ok(previous.is_some_and(|value| value.trim() != current))
}

/// The launcher's own filename -- the single source of truth shared by the
/// launcher binary itself (to exclude itself from apply/restore) and the
/// running app (to tell whether `default_install_dir()` already has one,
/// deciding whether Install can stage as an update or must place files
/// directly).
#[cfg(windows)]
pub const LAUNCHER_EXE_NAME: &str = "commits.exe";
#[cfg(not(windows))]
pub const LAUNCHER_EXE_NAME: &str = "commits";

/// Whether `data`'s SHA-256 digest matches `expected_hex` (case-insensitive).
pub fn verify_checksum(data: &[u8], expected_hex: &str) -> bool {
    let mut hasher = Sha256::new();
    hasher.update(data);
    let digest = hasher.finalize();
    let actual_hex = digest.iter().map(|byte| format!("{byte:02x}")).collect::<String>();
    actual_hex.eq_ignore_ascii_case(expected_hex.trim())
}

#[cfg(test)]
mod tests;
