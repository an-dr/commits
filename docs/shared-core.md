# Shared MIT commits core

## Source and license boundary

`packages/core` is a byte-for-byte snapshot of the `packages/core` package in
`an-dr-com-mit-s` at commit
`69271fe1462d5532f0a56b2872770121f6a4dbfd`. The source package's SHA-256
hashes were compared after copying with no mismatches. Its root MIT `LICENSE`
and `NOTICE.md` were copied beside the package without changing their text.

The package is no longer a byte-for-byte snapshot. Multi-branch selection was
added here rather than upstream, so `packages/core/src/webview` now carries
local modifications: `main.ts` and `branchPanel.ts` track several selected
branches, `branchSelection.ts` is new, and the view state and `loadCommits`
request gained the fields that carry them. `main.ts` also switches repository
when the host names a different active one, and routes every repository change
through one reset so selections never carry across repositories. ADR-008 records why.

The branch panel also diverges in what it shows. `branchPanelRender.ts` renders a
HEAD row carrying the checked-out revision, one section per remote named after
that remote, disclosure rows for folders, and a checkbox on every row; the panel
model gained the `head` field that carries the branch and revision, and
`branchPanel.ts` exposes `setHead` in place of `setCurrentBranch`. The
`branchPanelLocal` and `branchPanelRemote` strings gave way to
`branchPanelLocalBranches`. This follows a desktop Git client's panel rather than
the extension's original list, and the shared CSS in
`packages/webview-shell/assets/main.css` moved with it, so both hosts get the
same panel.

Every other file remains as imported, and the MIT grant and notice are
unchanged; MIT permits modification. What is lost is reproducibility: the
snapshot can no longer be verified by hashing against
`an-dr-com-mit-s`, and re-importing a newer upstream will conflict with these
changes rather than replace them cleanly. Upstreaming the multi-branch work and
re-importing is what restores that property.

## Working Bones slice

The standalone integration runs the unchanged shared webview without trying to
run the package's Node-only Git backend in WebAssembly:

- `apps/commits/bones-adapter/src/host/commits-core-workspace-port.ts` implements the imported
  `WorkspacePort` contract over repository paths supplied by Bones.
- `RepositoryManager` discovers host repositories through that shared
  contract.
- `packages/webview-shell` contains the host-independent DOM shell,
  translator-injected localization factory, and exact upstream webview CSS.
- Bones installs a `WebviewHost` adapter and calls the imported
  `startCommitsView()` entry point directly.
- `apps/commits/bones-adapter/src/mit/graph-backend.ts` maps graph reads to bounded native Git
  requests and returns the imported request/response models.
- The existing correlated Rust Git service remains the standalone Git backend.

The package's direct uses of `simple-git`, `node:fs`, `node:path`, and
`node:child_process` are intentionally not pulled into the WASM component.
Moving more behavior across requires a separate Git/filesystem port; it does
not require changing this baseline import first.

## Extension submodule layout

After this repository is pushed, the extension can replace its tracked
`packages/core` directory with this repository as a submodule:

```text
extensions/an-dr-com-mit-s/
└── packages/
    └── commits/          git submodule -> an-dr/commits
        └── packages/
            ├── core/             @an-dr/commits-core
            └── webview-shell/    shared DOM, localization, and CSS
```

The extension's workspace, TypeScript path alias, test alias, and esbuild
resolver should target both shared packages below `packages/commits`. The
extension host should supply `vscode.l10n.t` to `createLocalizedStrings()` and
use `buildGraphShell()` for its body. The switch must happen only after the
`commits` revision containing this snapshot is available
to the extension repository, so the submodule pointer is reproducible.
