//! Where this build looks for updates, and how it downloads one.
//!
//! See `docs/updating.md`, "Where updates come from": each build checks the
//! latest GitHub release for the manifest of its own build type, unless the
//! user's `app.updateManifestUrl` overrides it.

use std::io::Read;
use std::path::Path;
use std::time::Duration;

use base64::Engine;

/// The build type, fixed at compile time. It names the manifest this build
/// reads, so a Windows arm64 install is never offered an x64 payload.
pub const PLATFORM: Option<&str> = if cfg!(all(windows, target_arch = "x86_64")) {
    Some("windows-x64")
} else if cfg!(all(windows, target_arch = "aarch64")) {
    Some("windows-arm64")
} else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
    Some("linux-x64")
} else {
    None
};

const RELEASES: &str = "https://github.com/an-dr/commits/releases/latest/download";

/// The manifest to check: the user's override when set, otherwise this
/// platform's asset on the latest release, or `None` for a platform that has
/// no releases.
pub fn manifest_url(configured: &str) -> Option<String> {
    let configured = configured.trim();
    if !configured.is_empty() {
        return Some(configured.to_string());
    }
    PLATFORM.map(|platform| format!("{RELEASES}/commits-{platform}.json"))
}

/// A release zip is tens of megabytes; this leaves generous room while still
/// refusing a response that is plainly not one.
const MAX_DOWNLOAD_BYTES: u64 = 256 * 1024 * 1024;

/// Downloads release assets. The shared `os` fetch caps a response at 5 MB
/// and ten seconds in total, which suits a manifest but not a release zip, so
/// assets come through here instead: a far larger cap, and a timeout on each
/// read rather than on the whole transfer, so a slow link still finishes.
pub struct ReleaseDownload;

impl bones_upgrader::Fetch for ReleaseDownload {
    fn fetch_url(&self, url: &str) -> Result<Option<String>, String> {
        if !url.starts_with("https://") {
            return Err("only https URLs may be fetched".into());
        }
        // native-tls for the same reason as the `os` fetch: the Windows
        // toolchains here cannot build rustls's usual ring backend.
        let connector = native_tls::TlsConnector::new().map_err(|error| error.to_string())?;
        let agent = ureq::builder()
            .tls_connector(std::sync::Arc::new(connector))
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(60))
            .build();
        let response = match agent.get(url).call() {
            Ok(response) => response,
            Err(ureq::Error::Status(404, _)) => return Ok(None),
            Err(error) => return Err(error.to_string()),
        };
        let content_type = response.content_type().to_string();
        let mut body = Vec::new();
        response
            .into_reader()
            .take(MAX_DOWNLOAD_BYTES + 1)
            .read_to_end(&mut body)
            .map_err(|error| error.to_string())?;
        if body.len() as u64 > MAX_DOWNLOAD_BYTES {
            return Err(format!("download exceeds {MAX_DOWNLOAD_BYTES} bytes"));
        }
        // The upgrader's Fetch contract is a base64 body; the copy is brief
        // and bounded by the cap above.
        Ok(Some(format!("{content_type};base64,{}", base64::engine::general_purpose::STANDARD.encode(body))))
    }
}

/// Restores the executable bit that ZIP extraction drops on Unix. The
/// executables are the files at the top of a version folder with no
/// extension; everything else there is a page, a notice, or a folder.
#[cfg(unix)]
pub fn mark_executables(version_dir: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    for entry in std::fs::read_dir(version_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() && path.extension().is_none() {
            let mut permissions = std::fs::metadata(&path).map_err(|error| error.to_string())?.permissions();
            permissions.set_mode(permissions.mode() | 0o755);
            std::fs::set_permissions(&path, permissions).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

/// Windows has no executable bit; the extension already decides.
#[cfg(not(unix))]
pub fn mark_executables(_version_dir: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_override_wins_over_the_release_default() {
        assert_eq!(
            manifest_url("  https://example.com/m.json "),
            Some("https://example.com/m.json".to_string())
        );
    }

    #[test]
    fn an_empty_setting_reads_this_platforms_manifest_on_the_latest_release() {
        let expected = PLATFORM.map(|platform| {
            format!("https://github.com/an-dr/commits/releases/latest/download/commits-{platform}.json")
        });
        assert_eq!(manifest_url(""), expected);
    }

    #[test]
    #[cfg(all(target_os = "linux", target_arch = "x86_64"))]
    fn this_linux_build_is_linux_x64() {
        assert_eq!(PLATFORM, Some("linux-x64"));
    }

    #[test]
    fn a_non_https_download_is_refused() {
        use bones_upgrader::Fetch;
        assert!(ReleaseDownload.fetch_url("http://example.com/app.zip").is_err());
    }

    #[test]
    #[cfg(unix)]
    fn extracted_executables_become_runnable_and_other_files_do_not() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("commits-app"), b"binary").unwrap();
        std::fs::write(dir.path().join("page.html"), b"page").unwrap();
        for name in ["commits-app", "page.html"] {
            std::fs::set_permissions(dir.path().join(name), std::fs::Permissions::from_mode(0o644)).unwrap();
        }

        mark_executables(dir.path()).unwrap();

        let mode = |name: &str| std::fs::metadata(dir.path().join(name)).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode("commits-app"), 0o755);
        assert_eq!(mode("page.html"), 0o644);
    }
}
