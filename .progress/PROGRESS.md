# Progress

**Flow:** Detailed Auto
**Phase:** COMMIT
**Goal:** Fix the standalone read surface: show the commit file tree, expand a commit on double click, allow selecting multiple branches at once, and add a menu bar whose Open repo item opens the repository selector.
**Done when:** Double clicking a commit expands it and shows the file tree; multiple branches can be selected and the graph reflects the selection; a menu bar exposes Open repo which opens the selector; regression tests cover the commitDetails round trip and multi-branch request shape; docs record the packages/core divergence; npm run verify and cargo test --workspace pass.
**Constraints:** The file tree and expansion are one root cause: the core drops the shared views commitDetails request. Multi-branch selection requires editing packages/core/src/webview, which the user explicitly authorized after being told it ends the byte-for-byte snapshot; record that divergence in docs and an ADR. vendor/bones stays read-only. Keep the apps/crates/ipc/packages layout and run-time page delivery.
**Out of scope:** No mutating Git actions, no diff viewing or file opening beyond listing the tree, no changes to vendor/bones, no packaging or CI work.

## Iterations

- [x] **Commit details and file tree (~280 lines)** (completed) — Handle the commitDetails request in the core by running the native Git reads it needs, build the file tree the shared view expects, and reply so double click expands a commit.
- [x] **Menu bar with Open repo (~200 lines)** (completed) — Add a standalone menu bar to the page with an Open repo item that shows the repository selector, styled with the existing theme tokens.
- [x] **Multi-branch selection (~260 lines)** (completed) — Extend the shared webview branch panel and view state to hold several selected branches, send them together, and load commits across the selection.
- [x] **Record the shared core divergence (~120 lines)** (completed) — Update shared-core.md and THIRD_PARTY_NOTICES to state that packages/core now carries local modifications, and add an ADR superseding the unmodified-snapshot decision.
- [x] **Honour a host-requested repository switch (~150 lines)** (completed) — Treat a lastActiveRepo that differs from the shown repository as an instruction to switch and refresh, so opening a repository from the menu loads it.
- [x] **Reset view state on every repository change (~150 lines)** (completed) — Route all three repository switches through one helper that clears the branch selection, expanded commit and commit budget, so the graph and branch panel reload against the new repository.
- [x] **Readable page typography and scrollbars (~180 lines)** (completed) — Set a system UI font for the page so it stops falling back to the browser serif default, and style the scrollbars to match the theme in both light and dark.
- [x] **No console window in release builds (~60 lines)** (completed) — Mark the host as a Windows subsystem binary outside debug builds so the terminal no longer opens behind the app, while debug builds keep their log output.
- [ ] **Spawn git without console windows (~80 lines)** (verified) — Set CREATE_NO_WINDOW on spawned Git processes so a windowed host does not flash a console for every command.

_Last updated: 2026-08-02T09:14:30.9661136Z_