# ADR-008: Modify the shared core in place for multi-branch selection

Supersedes the unmodified-snapshot rule stated in `docs/shared-core.md`. The
license boundary is unchanged; only the promise that `packages/core` is a
byte-for-byte import no longer holds.

## Problem

Selecting several branches at once requires state the shared webview does not
have. `GitGraphView` tracked `currentBranch: string | null`, the branch panel
had no additive selection, and `loadCommits` carried a single `branchName`.
None of that can be changed from the standalone app, because the behaviour
lives entirely in `packages/core/src/webview`, which the VS Code extension
consumes by path as an unmodified snapshot.

## Decision

The change was made directly in `packages/core`. `currentBranches: string[]`
holds the selection, `currentBranch` mirrors its first entry so existing
single-branch call sites and saved view state keep working, Ctrl or Cmd click
toggles membership, and `loadCommits` gained an optional `branches` array
alongside the original `branchName`.

## Rationale

The user was told the cost and chose this over deferring the feature: doing it
upstream in `an-dr-com-mit-s` and re-importing would have delayed a feature
they wanted in this iteration.

The additions are deliberately additive rather than replacing. `currentBranch`
and `branchName` still mean what they meant, so a host that ignores the new
fields behaves exactly as before, and the eventual upstream merge is a smaller
diff than a rewrite would be.

## Consequences

`packages/core` can no longer be verified by hashing against its source
repository, and a future upstream import will conflict with these files instead
of replacing them cleanly. The standalone and extension user interfaces diverge
until the change is upstreamed. Restoring the original property means moving
this work into `an-dr-com-mit-s` and re-importing the result.

## Rejected alternatives

- Defer multi-branch selection until it exists upstream: keeps the snapshot
  verifiable, but does not deliver the feature now.
- Reimplement the branch panel standalone-side: leaves `packages/core` intact,
  but duplicates shared interface code that would then drift from the
  extension in a harder-to-reconcile way.
