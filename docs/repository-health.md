# Repository health

Commits owns this contract and the [conformance vectors](repository-health.vectors.json). Other applications can implement it independently and run the vectors against their own verdict function.

## Facts

| Fact | Type | Meaning |
| --- | --- | --- |
| exists | boolean | Repository folder exists |
| isRepo | boolean | Folder is a Git working tree |
| conflicted | integer | Files with unresolved conflicts |
| operation | string or null | merge, rebase, cherry-pick, revert, bisect, or null |
| ahead, behind | integer | Commits relative to upstream, zero without upstream |
| changes | integer | Staged, unstaged and untracked files |
| detached | boolean | HEAD is detached |
| hasCommits | boolean | HEAD resolves to a commit |
| hasUpstream | boolean | Current branch has an upstream |
| hasRemote | boolean | At least one remote exists |

## Verdicts

The first matching rule wins. Each repository has exactly one verdict.

| Rule | Id | Label | Urgency |
| --- | --- | --- | --- |
| !exists | missing | Missing | warning |
| !isRepo | not-a-repo | Not a repository | warning |
| conflicted > 0 | conflicted | Conflicts | warning |
| operation != null | in-progress | In progress | caution |
| ahead > 0 && behind > 0 | diverged | Diverged | caution |
| behind > 0 | behind | Behind | advisory |
| changes > 0 | dirty | Uncommitted | caution |
| ahead > 0 | ahead | Unpushed | advisory |
| detached && hasCommits | detached | Detached HEAD | caution |
| !hasUpstream && hasRemote && hasCommits | unpublished | Unpublished | advisory |
| otherwise | clean | Clean | normal |

Normal is neutral text without a badge. Advisory uses yellow-orange, caution red-orange, and warning pink. Counts accompany conflicts, behind, uncommitted and unpushed when useful. The tooltip for behind and diverged reads “Behind counts only what the last fetch saw”.

## Navigation and freshness

Clicking dirty opens changes; conflicted or in-progress opens conflicts. Diverged, behind, ahead and unpublished select the current branch; detached selects HEAD. Missing and not-a-repo do nothing. Facts refresh after Git actions, watcher refreshes and window focus. Ahead and behind describe the last fetch, without triggering a fetch.
