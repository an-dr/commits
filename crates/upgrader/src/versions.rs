//! Picks which version folder under an install dir is current, in a layout
//! where every installed version gets its own folder (`1.3.0/`, `1.2.0/`,
//! ...) instead of a single install dir overwritten in place. See
//! `docs/updating.md` for the full layout.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

/// Parses a dot-separated numeric version ("1.12.0") into comparable
/// segments. Shared by [`crate::is_newer`] and folder-name ordering here, so
/// both treat a malformed version identically (sorting as smaller than any
/// well-formed one, never mistaken for an update or a valid version folder).
pub(crate) fn parse_version_segments(version: &str) -> Option<Vec<u64>> {
    version.split('.').map(|part| part.parse().ok()).collect()
}

/// Compares two already-parsed version segment lists, padding the shorter
/// with zeros so `[1, 2]` reads as older than `[1, 10]`, not lexically.
pub(crate) fn compare_segments(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    let len = a.len().max(b.len());
    let pad = |v: &[u64]| {
        let mut v = v.to_vec();
        v.resize(len, 0);
        v
    };
    pad(a).cmp(&pad(b))
}

/// A version folder's name is its version, optionally followed by a
/// `-<disambiguator>` suffix (e.g. `1.3.0-a1b2c3d4`) for the case where a
/// build's version string collides with one already on disk -- typically a
/// dev build that never bumps its version between pushes. The suffix plays
/// no part in ordering; see [`VersionDir`]'s modified-time tiebreak for how
/// two folders with the same numeric version are actually ordered.
pub(crate) fn parse_folder_name(name: &str) -> Option<Vec<u64>> {
    let version_part = name.split('-').next().unwrap_or(name);
    parse_version_segments(version_part)
}

struct VersionDir {
    version: Vec<u64>,
    modified: SystemTime,
    path: PathBuf,
}

/// Every direct child of `install_dir` whose name parses as a version --
/// this is what excludes `commits.exe`, `updater/`, `components/`, `state/`,
/// and log files from being mistaken for a version folder, with no need for
/// an explicit skip list.
fn list_version_dirs(install_dir: &Path) -> Vec<VersionDir> {
    let Ok(entries) = fs::read_dir(install_dir) else {
        return Vec::new();
    };
    let mut dirs = Vec::new();
    for entry in entries.flatten() {
        let Ok(file_type) = entry.file_type() else { continue };
        if !file_type.is_dir() {
            continue;
        }
        let name = entry.file_name();
        let Some(version) = parse_folder_name(&name.to_string_lossy()) else {
            continue;
        };
        let modified = entry.metadata().and_then(|meta| meta.modified()).unwrap_or(SystemTime::UNIX_EPOCH);
        dirs.push(VersionDir { version, modified, path: entry.path() });
    }
    dirs
}

/// Version folders under `install_dir`, newest first: primarily by version
/// (highest wins), and for two folders with the *same* numeric version --
/// only possible via the disambiguating suffix above -- by modification
/// time, so the one actually installed most recently wins the tie rather
/// than an arbitrary one based on directory-entry order.
pub(crate) fn ordered_version_dirs(install_dir: &Path) -> Vec<PathBuf> {
    let mut dirs = list_version_dirs(install_dir);
    dirs.sort_by(|a, b| compare_segments(&a.version, &b.version).then(a.modified.cmp(&b.modified)));
    dirs.reverse();
    dirs.into_iter().map(|dir| dir.path).collect()
}

/// The version folder a launcher should run: the newest by [`ordered_version_dirs`],
/// or `None` if `install_dir` has no version folder at all.
pub fn current_version_dir(install_dir: &Path) -> Option<PathBuf> {
    ordered_version_dirs(install_dir).into_iter().next()
}

/// The version folder that becomes current once [`current_version_dir`] is
/// removed -- the next-newest one still on disk, or `None` if there is
/// nothing to fall back to (a fresh install with only one version). Read by
/// the launcher's `--rollback`, to say which version dropping this one
/// would land on.
pub fn previous_version_dir(install_dir: &Path) -> Option<PathBuf> {
    ordered_version_dirs(install_dir).into_iter().nth(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_version_dir(install_dir: &Path, name: &str) {
        fs::create_dir_all(install_dir.join(name)).unwrap();
    }

    #[test]
    fn current_version_dir_is_none_without_any_version_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(current_version_dir(dir.path()).is_none());
    }

    #[test]
    fn current_version_dir_picks_the_highest_numeric_version() {
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "1.2.0");
        make_version_dir(dir.path(), "1.10.0");
        make_version_dir(dir.path(), "1.9.0");

        let current = current_version_dir(dir.path()).unwrap();

        assert_eq!(current.file_name().unwrap(), "1.10.0");
    }

    #[test]
    fn non_version_named_entries_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "1.2.0");
        make_version_dir(dir.path(), "updater");
        make_version_dir(dir.path(), "components");
        make_version_dir(dir.path(), "state");
        fs::write(dir.path().join("commits.exe"), b"launcher").unwrap();
        fs::write(dir.path().join("commits.log"), b"log").unwrap();

        let current = current_version_dir(dir.path()).unwrap();

        assert_eq!(current.file_name().unwrap(), "1.2.0");
    }

    #[test]
    fn previous_version_dir_is_the_second_highest() {
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "1.2.0");
        make_version_dir(dir.path(), "1.3.0");
        make_version_dir(dir.path(), "1.1.0");

        let previous = previous_version_dir(dir.path()).unwrap();

        assert_eq!(previous.file_name().unwrap(), "1.2.0");
    }

    #[test]
    fn previous_version_dir_is_none_with_only_one_version() {
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "1.2.0");

        assert!(previous_version_dir(dir.path()).is_none());
    }

    #[test]
    fn a_disambiguated_suffix_still_orders_by_its_leading_version() {
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "1.2.0");
        make_version_dir(dir.path(), "1.10.0-a1b2c3d4");

        let current = current_version_dir(dir.path()).unwrap();

        assert_eq!(current.file_name().unwrap(), "1.10.0-a1b2c3d4");
    }

    #[test]
    fn same_numeric_version_breaks_the_tie_by_modification_time() {
        // Two dev-build pushes that never bump their version collide on the
        // bare folder name and get a disambiguating suffix (see
        // extract_version / copy_version_from_dir); the one installed most
        // recently -- not the one enumerated first by the filesystem --
        // should be treated as current.
        let dir = tempfile::tempdir().unwrap();
        make_version_dir(dir.path(), "0.0.0-aaaaaaaa");
        std::thread::sleep(std::time::Duration::from_millis(20));
        make_version_dir(dir.path(), "0.0.0-bbbbbbbb");

        let current = current_version_dir(dir.path()).unwrap();

        assert_eq!(current.file_name().unwrap(), "0.0.0-bbbbbbbb");
    }
}
