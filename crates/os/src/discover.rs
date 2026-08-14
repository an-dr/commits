use std::path::{Path, PathBuf};

/// How far below the scanned folder a repository is still found. Deep enough
/// for the usual `code/<group>/<repo>` layouts, shallow enough that pointing
/// the app at a home directory does not walk an entire disk.
pub const MAX_DEPTH: usize = 4;
/// Upper bound on reported repositories: a selector with more rows than this
/// is unusable anyway, and it caps what one scan can cost.
pub const MAX_REPOSITORIES: usize = 200;
/// Upper bound on directories looked at, so a wide tree that holds no
/// repository at all still ends the scan promptly.
const MAX_VISITED: usize = 20_000;

/// Directories that never hold a checkout worth listing but often hold tens of
/// thousands of entries.
const SKIPPED: [&str; 5] = ["node_modules", "target", "dist", "out", "build"];

/// Finds every git repository at or below `root`, `root` itself included.
///
/// The walk descends into repositories as well as plain folders, so a checkout
/// that contains unrelated clones -- submodules, or just another repository
/// someone cloned inside this one -- reports all of them. Ordering is the
/// walk's own: `root` first, then each subdirectory by name, which is what
/// lets a caller open the first result as "the one that was asked for".
pub fn find_repositories(root: &Path) -> Vec<PathBuf> {
    let mut found = Vec::new();
    let mut visited = 0;
    visit(root, 0, &mut visited, &mut found);
    found
}

/// Whether `path` is a git repository. A worktree or submodule has `.git` as a
/// file rather than a directory, so existence is the test, not `is_dir`.
pub fn is_repository(path: &Path) -> bool {
    path.join(".git").exists()
}

fn visit(directory: &Path, depth: usize, visited: &mut usize, found: &mut Vec<PathBuf>) {
    if found.len() >= MAX_REPOSITORIES || *visited >= MAX_VISITED {
        return;
    }
    *visited += 1;
    if is_repository(directory) {
        found.push(directory.to_path_buf());
    }
    if depth == MAX_DEPTH {
        return;
    }
    let Ok(entries) = std::fs::read_dir(directory) else { return };
    let mut children: Vec<PathBuf> = entries
        .flatten()
        // `file_type` here does not follow symlinks, so a link pointing back up
        // the tree is simply not a directory and the walk cannot loop.
        .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
        .map(|entry| entry.path())
        .filter(|path| !is_skipped(path))
        .collect();
    children.sort();
    for child in children {
        visit(&child, depth + 1, visited, found);
    }
}

fn is_skipped(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else { return true };
    // Hidden directories cover `.git` itself, which holds no repository but
    // plenty of entries.
    name.starts_with('.') || SKIPPED.contains(&name)
}

#[cfg(test)]
mod tests {
    use super::{find_repositories, is_repository, MAX_DEPTH};
    use std::path::Path;

    fn repository(path: &Path) {
        std::fs::create_dir_all(path.join(".git")).unwrap();
    }

    #[test]
    fn reports_the_scanned_folder_when_it_is_a_repository() {
        let root = tempfile::tempdir().unwrap();
        repository(root.path());
        assert_eq!(find_repositories(root.path()), vec![root.path().to_path_buf()]);
    }

    #[test]
    fn reports_sibling_repositories_of_a_plain_folder() {
        let root = tempfile::tempdir().unwrap();
        repository(&root.path().join("alpha"));
        repository(&root.path().join("beta"));
        std::fs::create_dir_all(root.path().join("notes")).unwrap();
        assert_eq!(
            find_repositories(root.path()),
            vec![root.path().join("alpha"), root.path().join("beta")]
        );
    }

    #[test]
    fn reports_repositories_nested_inside_a_repository() {
        let root = tempfile::tempdir().unwrap();
        repository(root.path());
        repository(&root.path().join("vendor/other"));
        assert_eq!(
            find_repositories(root.path()),
            vec![root.path().to_path_buf(), root.path().join("vendor/other")]
        );
    }

    #[test]
    fn ignores_repositories_below_the_depth_limit_and_in_skipped_folders() {
        let root = tempfile::tempdir().unwrap();
        let mut deep = root.path().to_path_buf();
        for _ in 0..=MAX_DEPTH {
            deep = deep.join("level");
        }
        repository(&deep);
        repository(&root.path().join("node_modules/thing"));
        assert!(find_repositories(root.path()).is_empty());
    }

    #[test]
    fn treats_a_git_file_as_a_repository() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join(".git"), "gitdir: ../.git/modules/thing").unwrap();
        assert!(is_repository(root.path()));
    }
}
