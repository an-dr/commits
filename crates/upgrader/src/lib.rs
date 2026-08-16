//! The self-update mechanism (crate name "upgrader", not "updater" — see
//! Cargo.toml for why).

use commits_os::OsBackend;
use sha2::{Digest, Sha256};

mod identity;
mod install;
pub mod launcher;
mod versions;
pub use identity::{host_identity, launcher_version, AppIdentity};
pub use install::{
    copy_version_from_dir, extract_version, install_fresh, refresh_launcher,
    refresh_launcher_from_running_exe, remove_version_dir,
};
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

/// Where a permanent install lives: `COMMITS_INSTALL_DIR` if set (tests),
/// otherwise `~/.commits/app`. Compared against the running process's own
/// directory to tell an installed run from a dev or ad-hoc one -- the Install
/// menu action only makes sense for the latter.
pub fn default_install_dir(identity: &AppIdentity) -> Option<std::path::PathBuf> {
    if let Ok(value) = std::env::var(identity.install_env_var) {
        return Some(std::path::PathBuf::from(value));
    }
    dirs::home_dir().map(|home| home.join(identity.install_dir_name).join("app"))
}

/// Whether `dir` is a version folder directly under the canonical install
/// location -- i.e. this process is `commits-app.exe` running from a version
/// folder `commits.exe` (the launcher) picked, rather than a dev build or an
/// ad-hoc launch. Shared by the Install menu's own installed-or-not check and
/// by callers that need to tell a shared, install-wide location (saves,
/// extensions, logs) apart from an exe-relative one. Canonicalized before
/// comparing: a raw comparison can mismatch even for the same directory
/// (e.g. drive-letter casing or short/long name form). A canonicalize
/// failure on the install side (the ordinary case: nothing is installed
/// there yet) reads as "not installed" rather than an error.
pub fn is_installed_version_dir(identity: &AppIdentity, dir: &std::path::Path) -> bool {
    let Ok(dir) = dir.canonicalize() else {
        return false;
    };
    let Some(install_dir) = default_install_dir(identity).and_then(|d| d.canonicalize().ok()) else {
        return false;
    };
    dir.parent() == Some(install_dir.as_path())
}

/// Whether `dir` is *shaped* like a version folder -- its own name parses
/// as a version, and its parent has a launcher executable in it --
/// regardless of whether that parent happens to be the canonical
/// `default_install_dir()`. Structural rather than location-based on
/// purpose: `dist.ps1` assembles a plain build directory in exactly this
/// shape (see `docs/phase-0-1.md`'s `.\dist\app\commits.exe`), so a dev
/// build run straight out of it needs to find its shared data one level up
/// the same way a real install does, without `COMMITS_INSTALL_DIR` having
/// to point at wherever it happens to be sitting.
pub(crate) fn is_version_folder(identity: &AppIdentity, dir: &std::path::Path) -> bool {
    let Some(name) = dir.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if versions::parse_folder_name(name).is_none() {
        return false;
    }
    dir.parent().is_some_and(|parent| parent.join(identity.launcher_exe()).is_file())
}

/// Resolves `name` against the shared, install-wide location (the install
/// dir itself, a level above the version folder) when the running
/// executable is inside a version folder (see [`is_version_folder`]), or
/// against the running executable's own directory otherwise. The latter
/// matches the `resolve_relative_to_exe` convention the bones engine
/// builder already uses for a relative `saves_dir`/`extensions_dir`, so an
/// ad-hoc build with no launcher beside it (no version-folder shape at all)
/// keeps finding everything beside itself exactly as before -- only a run
/// from inside a version folder, real install or `dist/app` alike, needs
/// the extra step up to keep state, components, and logs shared across
/// versions instead of siloed inside whichever version folder happens to
/// be running.
pub fn shared_or_exe_relative(identity: &AppIdentity, name: &str) -> Option<std::path::PathBuf> {
    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(shared_or_exe_relative_from(identity, &exe_dir, name))
}

fn shared_or_exe_relative_from(
    identity: &AppIdentity,
    exe_dir: &std::path::Path,
    name: &str,
) -> std::path::PathBuf {
    if is_version_folder(identity, exe_dir) {
        if let Some(install_dir) = exe_dir.parent() {
            return install_dir.join(name);
        }
    }
    exe_dir.join(name)
}

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
