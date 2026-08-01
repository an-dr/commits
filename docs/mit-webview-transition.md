# MIT webview transition plan

## Outcome

The standalone Bones application must render and operate the unchanged MIT
Git Graph webview from `packages/core/src/webview`, matching the extension's
table-and-lane layout. The former green Phase-4 page is not an acceptable
product surface and must no longer be on the packaged application path.

`packages/core` remains a byte-for-byte MIT snapshot. Shared HTML, CSS, and
localization live in an adjacent MIT `packages/webview-shell` package so both
the extension and standalone app can consume them. Standalone transport,
theme, persistence, and Git-runtime adaptation live outside both shared trees.

## Current mismatch

The standalone bundle currently starts `apps/commits/web/src/ui/app.ts`. It renders an
original card-based history list and consumes the old standalone
`repositorySnapshot` protocol. Only the shared `abbrevCommit` helper and
`WorkspacePort` type are used; the imported `startCommitsView()` function is
never bundled or started.

The MIT view expects:

- the extension's graph DOM shell and `media/main.css` / `media/dropdown.css`;
- global `viewState` configuration and `l10n` strings;
- an injected `WebviewHost` implementation;
- `loadRepos`, `loadBranches`, `loadCommits`, and detail/action responses;
- browser `message` events carrying the shared response protocol.

Bones already supplies page-to-component IPC, component-to-page JSON, a
correlated native Git runner, persistence, and OS capabilities. The transition
is therefore an adapter project, not a rewrite of the MIT view.

## Invariants

1. No file under `packages/core` is modified.
2. The repository root remains GPL-3.0; `packages/webview-shell` is MIT and
   carries the upstream license and notice with copied CSS and localization.
3. No Node API or `simple-git` dependency enters the WASM component.
4. Every native Git request remains correlated and bounded by a timeout.
5. Unsupported mutating commands return an explicit error; they never appear
   to succeed.

## Milestones

### M1 — Shared page shell and bundle

- Copy the MIT extension's two CSS files into `packages/webview-shell`.
- Create a host-independent graph DOM shell with every element ID required by
  the unchanged webview, reusable from Bones and VS Code.
- Supply translator-injected `LocalizedStrings`; keep only standalone theme
  variables in Bones.
- Install a Bones `WebviewHost`, translate `bones-message` custom events into
  browser `message` events, and call `startCommitsView()`.

Acceptance:

- the built page bundle contains `startCommitsView`;
- the old `startPage` entry is absent from the production bundle;
- a DOM smoke test starts the shared view without VS Code.

### M2 — Repository bootstrap and read-only graph

- Add standalone bootstrap/open-repository messages outside the shared
  protocol.
- Restore the last repository from Bones persistence.
- Show a standalone repository chooser only when no saved repository exists.
- Translate `loadRepos`, `selectRepo`, `loadBranches`, `loadCommits`, and
  `repoInProgress` requests.
- Implement shared graph response models over the correlated Rust Git runner,
  including refs, HEAD, commit parents, and uncommitted-change count.

Acceptance:

- opening `C:/00_Code/commits` renders branch groups, refs, commit lanes,
  author/date columns, and commit IDs in the MIT layout;
- refresh and branch filtering issue fresh native Git requests;
- no `simple-git` or Node builtin is bundled into WASM.

### M3 — Read interactions

- Implement commit details and changed-file data.
- Implement two-commit comparison.
- Implement full-file diff content.
- Bridge copy-to-clipboard and external URLs to Bones OS capabilities.

Acceptance:

- opening a commit renders metadata and changed files;
- selecting two commits renders their comparison;
- copy hash reports its real success/failure.

### M4 — Mutating operations

- Map branch, tag, checkout, cherry-pick, revert, reset, merge, fetch, pull,
  push, and in-progress operation commands to bounded native Git requests.
- Reuse the existing askpass/editor bridge for credential and editor prompts.
- Refresh only after a successful operation.

Acceptance:

- every visible action either works or is hidden/disabled;
- failures are shown by the MIT dialog path;
- mutation integration tests run only in disposable repositories.

### M5 — Retire the old product path

- Remove the old green page entry, HTML, CSS, and protocol dependencies from
  production builds.
- Keep only reusable native parsers/services needed by the MIT adapter.
- Update architecture and packaging documentation.

Acceptance:

- repository search finds no production import of `startPage`;
- `npm run build`, TypeScript tests, Rust workspace tests, WASM load tests, and
  release packaging pass.

### M6 — Visual verification

- Package and run the release against a repository with local and remote refs.
- Capture the app and compare the branch sidebar, graph lanes, table headers,
  toolbar, density, and viewport behavior with the extension reference.
- Fix host CSS variables or shell sizing outside `packages/core` until the
  structures match.

Acceptance:

- the initial repository view is recognizably the MIT Git Graph interface,
  not the former standalone card UI;
- no horizontal or document-level overflow hides primary controls at
  1100×720.

## Execution order

Milestones are implemented in order. M1 and M2 form the first shippable visual
cut. M3 follows before mutation support so the graph is useful without risking
repository state. The release package is regenerated only after the relevant
acceptance gates pass.

## Progress

- M1 complete: the production entry calls the unchanged `startCommitsView()`;
  shared shell, localization, and exact upstream CSS live in the reusable MIT
  `packages/webview-shell`; Bones owns only its IPC, chooser, state, and theme.
- M2 complete: repository bootstrap, branch loading, refs, commit parents,
  HEAD, lanes, and uncommitted counts run through bounded correlated native
  Git requests. The release bundle contains no Node or `simple-git` runtime.
- M3 partially complete: clipboard and external URL capabilities are bridged;
  commit details, comparison, and full-file content remain to be mapped.
- M4 pending: mutating commands currently return an explicit unsupported
  status instead of reporting false success.
- M5 production cutover complete: no production bundle import or emitted text
  references `startPage`, `repositorySnapshot`, or the old card layout. Legacy
  source/tests remain until their dependent types are retired safely.
- M6 build verification complete; the local-file browser preview was blocked
  by browser security policy. The release package is ready for user-run visual
  comparison against the extension at `dist/app`.
