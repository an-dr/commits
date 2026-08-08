use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::versions::ordered_version_dirs;
use crate::LAUNCHER_EXE_NAME;

/// How many version folders survive under an install dir after any install
/// operation: the current one and one to fall back to. Anything older is
/// deleted -- there is no longer a single `backup/` copy, since the
/// fallback *is* the previous version's own folder, still intact on disk.
const KEEP_VERSIONS: usize = 2;

/// Extracts a downloaded, checksum-verified ZIP payload into a new version
/// folder under `install_dir`, named `version` (or `version` plus a short
/// content hash if that name is already taken -- typically a dev build
/// that never bumps its version between pushes). `components/` travels
/// inside the version folder along with everything else: built-in WASM
/// components are versioned and updated with each release, not shared
/// across versions, so an old version's own components go with it when it
/// is later pruned. Prunes anything beyond the current and previous
/// version once extraction succeeds.
pub fn extract_version(archive_bytes: &[u8], install_dir: &Path, version: &str) -> Result<PathBuf, String> {
    let hash = short_hash(archive_bytes);
    let version_dir = install_dir.join(version_folder_name(install_dir, version, &hash));
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(archive_bytes)).map_err(|error| error.to_string())?;
    clear_dir(&version_dir)?;
    fs::create_dir_all(&version_dir).map_err(|error| error.to_string())?;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
        let Some(relative_path) = entry.enclosed_name() else {
            // A path that can't be safely joined under install_dir
            // (absolute, or escaping via "..") is refused rather than
            // silently skipped, since a payload doing that is either
            // corrupt or hostile.
            return Err(format!("zip entry {} has an unsafe path", entry.name()));
        };
        let target = version_dir.join(&relative_path);
        if entry.is_dir() {
            fs::create_dir_all(&target).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut contents = Vec::new();
        entry.read_to_end(&mut contents).map_err(|error| error.to_string())?;
        fs::write(&target, contents).map_err(|error| error.to_string())?;
    }
    prune_old_versions(install_dir)?;
    Ok(version_dir)
}

/// Copies `source_dir` (the running executable's own directory, a dev
/// build) into a new version folder under `install_dir`, the same way
/// [`extract_version`] does for a downloaded ZIP -- used by the Install
/// menu action to push a dev build without a manifest. `source_dir`'s own
/// launcher executable and runtime artifacts (WebView2 profile, state,
/// logs) are never part of a version folder, so they are excluded from the
/// copy; `components/` travels with the rest of the version folder exactly
/// as in `extract_version`. Prunes anything beyond the current and
/// previous version once the copy succeeds.
pub fn copy_version_from_dir(source_dir: &Path, install_dir: &Path, version: &str) -> Result<PathBuf, String> {
    let relative_files = collect_copyable_files(source_dir)?;
    let mut hasher = Sha256::new();
    for relative in &relative_files {
        let metadata = fs::metadata(source_dir.join(relative)).map_err(|error| error.to_string())?;
        hasher.update(relative.to_string_lossy().as_bytes());
        hasher.update(metadata.len().to_le_bytes());
        if let Ok(modified) = metadata.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                hasher.update(duration.as_nanos().to_le_bytes());
            }
        }
    }
    let hash = truncated_hex(&hasher.finalize());
    let version_dir = install_dir.join(version_folder_name(install_dir, version, &hash));
    if is_inside(&version_dir, source_dir) {
        return Err(String::from("install_dir must not be nested inside source_dir"));
    }
    clear_dir(&version_dir)?;
    for relative in &relative_files {
        let target = version_dir.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        fs::copy(source_dir.join(relative), &target).map_err(|error| error.to_string())?;
    }
    prune_old_versions(install_dir)?;
    Ok(version_dir)
}

/// Places a build directly at `install_dir` when nothing is installed
/// there yet -- there is no launcher present to ever apply anything
/// staged, so this completes the install outright: the launcher executable
/// found near `source_dir` goes to `install_dir` itself, and everything
/// else becomes the first version folder.
pub fn install_fresh(source_dir: &Path, install_dir: &Path, version: &str) -> Result<(), String> {
    let Some(launcher_source) = find_launcher_near(source_dir) else {
        return Err(format!("{LAUNCHER_EXE_NAME} not found in or above {}", source_dir.display()));
    };
    fs::create_dir_all(install_dir).map_err(|error| error.to_string())?;
    fs::copy(&launcher_source, install_dir.join(LAUNCHER_EXE_NAME)).map_err(|error| error.to_string())?;
    copy_version_from_dir(source_dir, install_dir, version)?;
    Ok(())
}

/// [`LAUNCHER_EXE_NAME`] beside `source_dir` itself -- a flat dev build, the
/// same shape a raw `cargo build` output (`target/release/`) still has, with
/// the launcher and `commits-app.exe` as siblings -- or, failing that, one
/// level up: `source_dir` running_directory() resolves to is now often a
/// version folder (e.g. running straight out of `dist/app/<version>/`, or an
/// already-installed version folder), where the launcher is a sibling of
/// the version folder, not inside it.
fn find_launcher_near(source_dir: &Path) -> Option<PathBuf> {
    let direct = source_dir.join(LAUNCHER_EXE_NAME);
    if direct.is_file() {
        return Some(direct);
    }
    let sibling = source_dir.parent()?.join(LAUNCHER_EXE_NAME);
    sibling.is_file().then_some(sibling)
}

/// Deletes a single version folder outright. Used by the launcher when a
/// version fails its health check: there is nothing to restore, since the
/// previous version's own folder was never touched by installing this one.
pub fn remove_version_dir(version_dir: &Path) -> Result<(), String> {
    clear_dir(version_dir)
}

/// Deletes every version folder under `install_dir` except the newest
/// [`KEEP_VERSIONS`] (by [`ordered_version_dirs`]) -- the current version
/// and one fallback to roll back to.
fn prune_old_versions(install_dir: &Path) -> Result<(), String> {
    for stale in ordered_version_dirs(install_dir).into_iter().skip(KEEP_VERSIONS) {
        fs::remove_dir_all(&stale).map_err(|error| error.to_string())?;
    }
    Ok(())
}

/// `version`, unless a folder by that exact name already exists under
/// `install_dir` -- in which case `hash` (already computed from the
/// content being installed) disambiguates it, so two different builds
/// reporting the same version never collide on one folder.
fn version_folder_name(install_dir: &Path, version: &str, hash: &str) -> String {
    if install_dir.join(version).exists() {
        format!("{version}-{hash}")
    } else {
        version.to_string()
    }
}

/// Every file under `source_dir`, as paths relative to it, skipping
/// [`LAUNCHER_EXE_NAME`] and anything [`is_runtime_artifact`] recognizes at
/// any depth -- neither belongs in a version folder.
fn collect_copyable_files(source_dir: &Path) -> Result<Vec<PathBuf>, String> {
    let mut files = Vec::new();
    collect_copyable_files_into(source_dir, Path::new(""), &mut files)?;
    files.sort();
    Ok(files)
}

fn collect_copyable_files_into(base: &Path, relative: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let current = base.join(relative);
    if !current.is_dir() {
        return Ok(());
    }
    for entry in fs::read_dir(&current).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        if is_runtime_artifact(&name) || name.to_string_lossy().eq_ignore_ascii_case(LAUNCHER_EXE_NAME) {
            continue;
        }
        let entry_relative = relative.join(&name);
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_dir() {
            collect_copyable_files_into(base, &entry_relative, out)?;
        } else {
            out.push(entry_relative);
        }
    }
    Ok(())
}

/// Whether `name` is a directory an executable creates for its own runtime
/// use rather than something that was ever part of the distributable app --
/// WebView2's own per-executable browser profile, the bones save-slot
/// directory, and rotated log files. A real run of the predecessor of
/// [`copy_version_from_dir`] hit a WebView2 profile file locked by the
/// still-running source process and aborted the copy partway through,
/// which is why these are excluded rather than merely skipped on error.
fn is_runtime_artifact(name: &std::ffi::OsStr) -> bool {
    let name = name.to_string_lossy();
    name.ends_with(".WebView2") || name.eq_ignore_ascii_case("state") || name.to_ascii_lowercase().ends_with(".log")
}

/// The first 8 hex characters of `data`'s SHA-256 digest -- enough to tell
/// two different builds' folders apart without a full 64-character digest
/// cluttering the folder name.
fn short_hash(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    truncated_hex(&hasher.finalize())
}

fn truncated_hex(digest: &[u8]) -> String {
    digest.iter().take(4).map(|byte| format!("{byte:02x}")).collect()
}

/// Whether `candidate` is `ancestor` itself or nested inside it. Both sides
/// are canonicalized before comparing -- comparing one canonicalized path
/// against one raw path is not safe even when the raw side exists:
/// canonicalizing on Windows can add a `\\?\` prefix or resolve
/// short/long name differences, so a not-yet-created `candidate` compared
/// against a canonicalized `ancestor` can spuriously mismatch even when it
/// really is nested underneath.
fn is_inside(candidate: &Path, ancestor: &Path) -> bool {
    canonicalize_best_effort(candidate).starts_with(canonicalize_best_effort(ancestor))
}

/// Canonicalizes `path`, or -- if it does not exist yet -- canonicalizes its
/// nearest existing ancestor and re-appends the missing suffix, so the
/// result is comparable to another canonicalized path regardless of whether
/// `path` itself has been created.
fn canonicalize_best_effort(path: &Path) -> PathBuf {
    if let Ok(canonical) = path.canonicalize() {
        return canonical;
    }
    let mut missing = Vec::new();
    let mut current = path;
    while let Some(parent) = current.parent() {
        missing.push(current.file_name().unwrap_or_default().to_os_string());
        if let Ok(mut canonical) = parent.canonicalize() {
            canonical.extend(missing.into_iter().rev());
            return canonical;
        }
        current = parent;
    }
    path.to_path_buf()
}

/// Removes everything at `path` without requiring it to already exist.
fn clear_dir(path: &Path) -> Result<(), String> {
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn zip_bytes(entries: &[(&str, &[u8])]) -> Vec<u8> {
        let mut buffer = Vec::new();
        {
            let mut writer = zip::ZipWriter::new(std::io::Cursor::new(&mut buffer));
            let options: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            for (name, contents) in entries {
                writer.start_file(*name, options).unwrap();
                writer.write_all(contents).unwrap();
            }
            writer.finish().unwrap();
        }
        buffer
    }

    #[test]
    fn extract_version_creates_a_version_folder_named_after_the_version() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        let archive = zip_bytes(&[("commits-app.exe", b"the app"), ("page.html", b"<html></html>")]);

        let version_dir = extract_version(&archive, &install_dir, "1.3.0").unwrap();

        assert_eq!(version_dir, install_dir.join("1.3.0"));
        assert_eq!(fs::read(version_dir.join("commits-app.exe")).unwrap(), b"the app");
        assert_eq!(fs::read(version_dir.join("page.html")).unwrap(), b"<html></html>");
    }

    #[test]
    fn extract_version_keeps_components_inside_the_version_folder() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        let archive = zip_bytes(&[("commits-app.exe", b"the app"), ("components/commits.wasm", b"component")]);

        let version_dir = extract_version(&archive, &install_dir, "1.3.0").unwrap();

        assert_eq!(fs::read(version_dir.join("components/commits.wasm")).unwrap(), b"component");
        assert!(!install_dir.join("components").exists());
    }

    #[test]
    fn extract_version_disambiguates_a_version_string_collision() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        extract_version(&zip_bytes(&[("commits-app.exe", b"first build")]), &install_dir, "0.0.0-dev").unwrap();

        let second =
            extract_version(&zip_bytes(&[("commits-app.exe", b"second build")]), &install_dir, "0.0.0-dev").unwrap();

        assert_ne!(second, install_dir.join("0.0.0-dev"));
        assert!(second.file_name().unwrap().to_string_lossy().starts_with("0.0.0-dev-"));
        assert_eq!(fs::read(install_dir.join("0.0.0-dev/commits-app.exe")).unwrap(), b"first build");
        assert_eq!(fs::read(second.join("commits-app.exe")).unwrap(), b"second build");
    }

    #[test]
    fn extract_version_prunes_versions_beyond_the_current_and_previous() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        extract_version(&zip_bytes(&[("a", b"1")]), &install_dir, "1.0.0").unwrap();
        extract_version(&zip_bytes(&[("a", b"2")]), &install_dir, "1.1.0").unwrap();

        extract_version(&zip_bytes(&[("a", b"3")]), &install_dir, "1.2.0").unwrap();

        assert!(!install_dir.join("1.0.0").exists());
        assert!(install_dir.join("1.1.0").exists());
        assert!(install_dir.join("1.2.0").exists());
    }

    #[test]
    fn extract_version_refuses_an_unsafe_zip_entry_path() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        let archive = zip_bytes(&[("../escape.txt", b"bad")]);

        assert!(extract_version(&archive, &install_dir, "1.0.0").is_err());
    }

    #[test]
    fn copy_version_from_dir_copies_the_running_directory_into_a_version_folder() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("dev-build");
        let install_dir = dir.path().join("app");
        fs::create_dir_all(source_dir.join("components")).unwrap();
        fs::write(source_dir.join("commits.exe"), b"the launcher").unwrap();
        fs::write(source_dir.join("commits-app.exe"), b"the app").unwrap();
        fs::write(source_dir.join("components/commits.wasm"), b"component").unwrap();

        let version_dir = copy_version_from_dir(&source_dir, &install_dir, "1.0.0").unwrap();

        assert_eq!(fs::read(version_dir.join("commits-app.exe")).unwrap(), b"the app");
        assert!(!version_dir.join("commits.exe").exists());
        assert_eq!(fs::read(version_dir.join("components/commits.wasm")).unwrap(), b"component");
        assert!(!install_dir.join("components").exists());
    }

    #[test]
    fn copy_version_from_dir_skips_webview2_profiles_state_and_logs() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("dev-build");
        let install_dir = dir.path().join("app");
        fs::create_dir_all(source_dir.join("commits-app.exe.WebView2/EBWebView")).unwrap();
        fs::write(source_dir.join("commits-app.exe.WebView2/EBWebView/lock"), b"locked").unwrap();
        fs::create_dir_all(source_dir.join("state")).unwrap();
        fs::write(source_dir.join("state/save.bin"), b"save state").unwrap();
        fs::write(source_dir.join("commits.log"), b"log").unwrap();
        fs::write(source_dir.join("commits-app.exe"), b"the app").unwrap();

        let version_dir = copy_version_from_dir(&source_dir, &install_dir, "1.0.0").unwrap();

        assert!(!version_dir.join("commits-app.exe.WebView2").exists());
        assert!(!version_dir.join("state").exists());
        assert!(!version_dir.join("commits.log").exists());
        assert_eq!(fs::read(version_dir.join("commits-app.exe")).unwrap(), b"the app");
    }

    #[test]
    fn copy_version_from_dir_disambiguates_a_version_string_collision() {
        let dir = tempfile::tempdir().unwrap();
        let install_dir = dir.path().join("app");
        let first_source = dir.path().join("first");
        fs::create_dir_all(&first_source).unwrap();
        fs::write(first_source.join("commits-app.exe"), b"first build").unwrap();
        copy_version_from_dir(&first_source, &install_dir, "0.0.0-dev").unwrap();

        let second_source = dir.path().join("second");
        fs::create_dir_all(&second_source).unwrap();
        fs::write(second_source.join("commits-app.exe"), b"second build, different size").unwrap();
        let second = copy_version_from_dir(&second_source, &install_dir, "0.0.0-dev").unwrap();

        assert_ne!(second, install_dir.join("0.0.0-dev"));
        assert_eq!(fs::read(install_dir.join("0.0.0-dev/commits-app.exe")).unwrap(), b"first build");
        assert_eq!(fs::read(second.join("commits-app.exe")).unwrap(), b"second build, different size");
    }

    #[test]
    fn install_fresh_places_the_launcher_at_the_root_and_the_rest_in_a_version_folder() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("dev-build");
        let install_dir = dir.path().join("app");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join(LAUNCHER_EXE_NAME), b"the launcher").unwrap();
        fs::write(source_dir.join("commits-app.exe"), b"the app").unwrap();

        install_fresh(&source_dir, &install_dir, "1.0.0").unwrap();

        assert_eq!(fs::read(install_dir.join(LAUNCHER_EXE_NAME)).unwrap(), b"the launcher");
        assert_eq!(fs::read(install_dir.join("1.0.0/commits-app.exe")).unwrap(), b"the app");
    }

    #[test]
    fn install_fresh_finds_the_launcher_one_level_up_from_a_version_folder_source() {
        // running_directory() often resolves to a version folder now (e.g.
        // running straight out of dist/app/<version>/), where the launcher
        // is a sibling of the version folder, not inside it.
        let dir = tempfile::tempdir().unwrap();
        let build_root = dir.path().join("dist-app");
        let source_dir = build_root.join("0.3.0");
        let install_dir = dir.path().join("app");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(build_root.join(LAUNCHER_EXE_NAME), b"the launcher").unwrap();
        fs::write(source_dir.join("commits-app.exe"), b"the app").unwrap();

        install_fresh(&source_dir, &install_dir, "1.0.0").unwrap();

        assert_eq!(fs::read(install_dir.join(LAUNCHER_EXE_NAME)).unwrap(), b"the launcher");
        assert_eq!(fs::read(install_dir.join("1.0.0/commits-app.exe")).unwrap(), b"the app");
    }

    #[test]
    fn install_fresh_fails_without_a_launcher_in_source_dir_or_its_parent() {
        let dir = tempfile::tempdir().unwrap();
        let source_dir = dir.path().join("dev-build");
        let install_dir = dir.path().join("app");
        fs::create_dir_all(&source_dir).unwrap();
        fs::write(source_dir.join("commits-app.exe"), b"the app").unwrap();

        assert!(install_fresh(&source_dir, &install_dir, "1.0.0").is_err());
    }

    #[test]
    fn remove_version_dir_deletes_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let version_dir = dir.path().join("1.0.0");
        fs::create_dir_all(&version_dir).unwrap();
        fs::write(version_dir.join("commits-app.exe"), b"bad build").unwrap();

        remove_version_dir(&version_dir).unwrap();

        assert!(!version_dir.exists());
    }

    #[test]
    fn remove_version_dir_succeeds_when_nothing_is_there() {
        let dir = tempfile::tempdir().unwrap();
        let version_dir = dir.path().join("1.0.0");

        assert!(remove_version_dir(&version_dir).is_ok());
    }
}
