# Changelog

All notable changes to Commits are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions before 1.8.0, except 1.0.0, were never tagged, so their headings have no comparison link.

## [Unreleased]

### Changed

- A file with an unresolved merge conflict is marked C (Conflicted) in the working-tree list instead of passing for a modified file.
- Commits uses bones with required startup extensions: when the commits component cannot load, startup stops with a dialog giving the reason instead of opening a blank window.
- Core settings are named `commits.<name>`, or `commits-vsc.<name>` for settings only VSCode Commits reads, instead of `an-dr-com-mit-s.<name>`; an existing `settings.json` is migrated when it is read.

### Removed

- The placeholder `hello` component no longer ships in releases or loads at startup.

## [1.10.0] - 2026-10-30

### Changed

- Commits uses bones 3.1.0 with its now opt-in WebAssembly extension host enabled; the extension ABI is unchanged, so the existing components load as before.
- Native build assembly, CI and release packaging use `cargo xtask`; npm frontend builds and the Windows installation helper remain available.

### Fixed

- Repeated source installations use Bones-compatible `version~instance` folders and leave previous build files intact.

## [1.9.2] - 2026-10-17

### Fixed

- Selecting an untracked file shows its whole contents as added lines instead of "This file has no contents to show".

## [1.9.1] - 2026-10-15

### Fixed

- Windows repository watching ignores Git metadata locks when the watched path and canonical metadata path differ in letter case, preventing unnecessary refreshes.
- Repository watching resolves junctions and Windows short paths before registering watches, so Git metadata locks are recognized and ignored through those paths too.

## [1.9.0] - 2026-10-14

### Added

- A second `commits` launch hands its arguments to the running window instead of opening another one, including launches received while a repository is still loading.
- `--show changes|conflicts|graph`, `--branch`, and `--commit` select a view, branch tip, or commit; a missing or out-of-range target shows a notice instead of an error.
- `--theme light|dark` and `--theme-file` style one session without changing saved settings.
- A repository health verdict beside the selector, such as Uncommitted, Behind, or Conflicts, which jumps to what needs attention when clicked. Its rules and conformance vectors are published for other tools.
- Repository lists supplied by other programs in `~/.commits/sources/`, shown as grouped selector sections with favourites first.
- ADR-013, which records these caller contracts as stable.

### Changed

- Commits now runs on the bones 2 kernel, which provides updates, desktop registration, single-instance handling, the development control channel, and folder watching.
- Command-line navigation searches at most 2,000 commits, the graph's own load limit, and its notice names that limit.
- Saving a light or dark preset in Settings replaces a palette supplied with `--theme-file`.

### Removed

- **Breaking:** `commits --rollback`. Use `commits --previous` to start the previous installed build.

### Fixed

- A launch with a path that cannot be opened no longer applies its navigation flags to the repository that is open.
- The in-progress operation banner shows correct staged, changed, untracked, and conflicted counts.
- Repository sources list a Windows folder once when its paths differ only in letter case.
- Opening the Open… menu refreshes repository sources.

## [1.8.1] - 2026-10-09

### Added

- Tagged releases publish a ZIP and manifest for each build type, and the app updates from the latest GitHub release for its own platform.

### Fixed

- The diff row highlight reaches the edge of a horizontally scrolled view.

## [1.8.0] - 2026-09-28

### Added

- Syntax highlighting in the full-diff panel.

## 1.7.0 - 2026-09-28

### Added

- The installed app registers with Windows and Linux desktops: folder actions, a Start Menu entry, and an application-list entry.

## 1.6.0 - 2026-09-09

### Added

- A ready or busy light beside the repository selector.
- Submodule status, remote management and push, and GitHub sign-in through the device flow.

## 1.5.1 - 2026-09-08

### Fixed

- A web view crash on Linux, a watcher deadlock, and hardened credential prompts.

## 1.5.0 - 2026-08-23

### Changed

- Clipboard, browser, file pickers, HTTPS fetch, self-update, and the wire codec come from bones instead of local copies.

## 1.4.0 - 2026-08-23

### Added

- A button bar for the side panels, each with its own toggle.

## 1.3.0 - 2026-08-21

### Added

- Open a repository or a diff in an external tool, such as VS Code.

## 1.2.0 - 2026-08-18

### Added

- Drag a branch or tag onto a commit in the graph.

## 1.1.0 - 2026-08-16

### Added

- The app replaces the launcher that started it with its own version.

### Fixed

- Windows ARM64 builds and the artifacts published for every Windows target.

## 1.0.1 - 2026-08-15

### Added

- Open a repository named on the command line, and every repository a folder holds.
- Watch the open repository and refresh when it changes outside the app.
- Create branches and tags, finish interrupted operations, and run commit actions natively.
- A tag list and foldable sections in the branch panel.
- Refs told apart by shape instead of by icon.

### Fixed

- Graph nodes drifting off their rows, dashed edges, missing tags, and a graph stuck loading.
- Every Git action reloading the graph from scratch, and switching branch losing the scroll position.
- Filtering the commit list hiding the graph.
- A partially staged file losing one of its two rows, and the changes panel listing paths instead of a tree.
- Settings failing to save while another process holds the file.

## [1.0.0] - 2026-08-08

### Added

- Settings apply live, in a redesigned dialog with sections and descriptions.
- A restructured File and About menu, the app icon in Windows executables, and a default and minimum window size.

## 0.3.1 - 2026-08-08

### Added

- A repository and submodule tree selector.

### Fixed

- Installs keep saves, extensions, and logs shared across version folders, and Install finds the launcher when run from a version folder.

## 0.3.0 - 2026-08-08

### Changed

- Installs keep each version in its own folder, and the launcher starts the newest, instead of copying over the previous build.

### Added

- A one-time confirmation after a successful update.

## 0.2.0 - 2026-08-07

### Added

- An About menu with version, Install, and Update; self-update with checksum-verified downloads; and an install script.
- Clone, open, and reveal the Commits repository from the File menu.
- Gravatar avatars for commit authors, and Tabler icons on the toolbar.

### Fixed

- The launcher's console window, and the web view's native context menu replacing the app's own.

## 0.1.0 - 2026-08-01

### Added

- The first standalone build: the shared repository graph and commit table in a bones window, native Git, file-backed settings and state, repository discovery, and credential prompts.

[Unreleased]: https://github.com/an-dr/commits/compare/v1.10.0...HEAD
[1.10.0]: https://github.com/an-dr/commits/compare/v1.9.2...v1.10.0
[1.9.2]: https://github.com/an-dr/commits/compare/v1.9.1...v1.9.2
[1.9.1]: https://github.com/an-dr/commits/compare/v1.9.0...v1.9.1
[1.9.0]: https://github.com/an-dr/commits/compare/v1.8.1...v1.9.0
[1.8.1]: https://github.com/an-dr/commits/compare/v1.8.0...v1.8.1
[1.8.0]: https://github.com/an-dr/commits/compare/v1.0.0...v1.8.0
[1.0.0]: https://github.com/an-dr/commits/releases/tag/v1.0.0
