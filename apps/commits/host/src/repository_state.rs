//! Native facts about a repository path that Git cannot report for a folder
//! that is missing or not a repository: whether it exists, whether it is a
//! repository, and which operation is in progress. The health reader asks for
//! them; see docs/repository-health.md.
use std::path::{Path, PathBuf};

use bones_kernel::bus::{Envelope, Handler, Module, ModuleContext};

/// Bus endpoint answering one repository path per request.
pub const ENDPOINT: &str = "repository-state";

const OWNER: &str = "commits";

#[derive(Default)]
pub struct RepositoryStateModule;

impl Handler for RepositoryStateModule {
    fn handle(&mut self, _envelope: &Envelope) {}
}

impl Module for RepositoryStateModule {
    fn name(&self) -> &str {
        ENDPOINT
    }

    fn init(&mut self, _context: &mut ModuleContext) -> Result<(), String> {
        Ok(())
    }

    /// The payload is the repository path as UTF-8; the answer is JSON
    /// `{ exists, isRepo, operation }`.
    fn respond(&mut self, sender: &str, payload: &[u8]) -> Option<Vec<u8>> {
        if sender != OWNER {
            return None;
        }
        let path = std::str::from_utf8(payload).ok().filter(|path| !path.is_empty())?;
        serde_json::to_vec(&repository_state(Path::new(path))).ok()
    }
}

/// Reads a repository's existence and in-progress operation from its Git
/// metadata, following a linked worktree's or submodule's `gitdir:` file.
fn repository_state(path: &Path) -> serde_json::Value {
    let marker = path.join(".git");
    let metadata = if marker.is_dir() {
        Some(marker)
    } else {
        std::fs::read_to_string(&marker)
            .ok()
            .and_then(|text| {
                text.trim().strip_prefix("gitdir:").map(|value| {
                    let target = PathBuf::from(value.trim());
                    if target.is_absolute() {
                        target
                    } else {
                        path.join(target)
                    }
                })
            })
            .filter(|target| target.is_dir())
    };
    let operation = metadata.as_ref().and_then(|git| {
        [
            ("rebase-merge", "rebase"),
            ("rebase-apply", "rebase"),
            ("MERGE_HEAD", "merge"),
            ("CHERRY_PICK_HEAD", "cherry-pick"),
            ("REVERT_HEAD", "revert"),
            ("BISECT_LOG", "bisect"),
        ]
        .into_iter()
        .find(|(marker, _)| git.join(marker).exists())
        .map(|(_, operation)| operation)
    });
    serde_json::json!({ "exists": path.is_dir(), "isRepo": metadata.is_some(), "operation": operation })
}

#[cfg(test)]
mod tests {
    use super::repository_state;

    #[test]
    fn detects_bisect_and_linked_worktree_operation_markers() {
        let directory = tempfile::tempdir().unwrap();
        let worktree = directory.path().join("worktree");
        let git = directory.path().join("metadata");
        std::fs::create_dir_all(&worktree).unwrap();
        std::fs::create_dir_all(&git).unwrap();
        std::fs::write(worktree.join(".git"), "gitdir: ../metadata").unwrap();
        std::fs::write(git.join("BISECT_LOG"), "bisect").unwrap();
        assert_eq!(repository_state(&worktree)["operation"], "bisect");
        assert_eq!(
            repository_state(&directory.path().join("missing"))["exists"],
            false
        );
    }
}
