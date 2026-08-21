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

The working tree is a local addition too. `changesPanelRender.ts` is new, `main.ts`
opens the uncommitted row as a changes panel and carries the commit surface, the
`workingTreeChanges` query and the `stageFiles`, `unstageFiles`, `discardFiles`
and `commitChanges` actions are new in the protocol, and `fullDiffContent` gained
a `staged` flag naming which side of the index a file was clicked on.

The branch panel also diverges in what it shows. `branchPanelRender.ts` renders a
HEAD row carrying the checked-out revision, one section per remote named after
that remote, disclosure rows for folders, a checkbox on every row, the remote
each branch tracks, and each remote's fetch URL; the panel model gained the
`head` and `remoteInfo` fields that carry them, and `branchPanel.ts` exposes
`setHead` and `setRemoteInfo` in place of `setCurrentBranch`. The `loadBranches`
response gained optional `upstreams` and `remotes` maps, so a host that sends
neither still gets the panel without those marks. The
`branchPanelLocal` and `branchPanelRemote` strings gave way to
`branchPanelLocalBranches`. This follows a desktop Git client's panel rather than
the extension's original list, and the shared CSS in
`packages/webview-shell/assets/main.css` moved with it, so both hosts get the
same panel.

The "ui improvements" iteration diverges further, all inside
`packages/core/src/webview`. Column widths are fixed by the stylesheet rather
than user-resizable: `main.ts` no longer implements drag-to-resize, and the
`GitRepoState.columnWidths` field it used to write is untouched dead protocol
surface now, left as-is rather than removed from the imported type. The Dev
column's visible text is a new compact today-or-date display
(`getCompactCommitDate`) that always wins over the `dateFormat` setting's
"Date Only"/"Relative" modes for that one column; `dateFormat` itself is still
accepted and stored for `core` round-tripping (see `docs/settings.md`), but
`formatRelativeDate`, `getRelativeFormatter`, and `RELATIVE_UNITS` were removed
from `utils/date.ts` once that was their only caller. `filesPanel.ts` lost its
header bar (`setHeader`, `headerElem`) entirely, so the panel has no title text
above the file list any more. None of this is upstreamable as-is; re-importing
would need to decide whether these behaviors move with it.

Settings can now be applied without reopening the view. `GitGraphView` gained
a public `updateConfig()` that merges into its existing `config` object in
place instead of replacing it, `startCommitsView`'s one-shot config/density/
refresh-shortcut setup was extracted into reusable functions, and `main.ts`
now exports `applyLiveSettings()`, which the standalone host calls after a
settings save. See ADR-010.

Refs can be dragged in the graph. `dragDrop.ts` is new and holds the DOM-free
half -- the private `application/vnd.an-dr-commits-ref` payload and the rules
saying what a dropped ref may do -- while `main.ts` renders local branch and
tag badges as draggable, highlights the row under the pointer, and opens a
menu on the drop offering to move the branch, reset or rebase the checked-out
one, or move the tag. Remote-tracking badges and the uncommitted row take no
part. The protocol grew with it: `createBranch` and `addTag` carry a `force`
flag, and `rebase` is a new non-interactive action, implemented in
`packages/core`'s own backend and in the standalone adapter alike. The extension
this came from reads the drag payload during `dragover`, which the browser
blanks until the drop; here the type list is checked instead, so the drop is
actually accepted.

External tools are a further local addition. `externalTools.ts` is new and
decides which configured tool answers which gesture, `toolbar.ts` grew a split
button -- a label plus a chevron half that opens a menu without changing what a
click runs -- and `main.ts` declares an Open in button last, so the shell's new
`openInBtn` sits against the app menu. Double-clicking a file in the tree runs
a configured diff tool instead of the host's own diff view, and falls back to
it when none is configured. The protocol gained `runTool`, and the view state
an optional `tools` list, which a host that configures none simply omits --
that is what keeps the extension flavor's toolbar unchanged.

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
