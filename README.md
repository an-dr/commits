# commits

A standalone desktop Git client built on the
[`bones`](vendor/bones) engine. The repository contains an unchanged MIT
snapshot of `@an-dr/commits-core` in [`packages/core`](packages/core) and a
reusable MIT webview shell in [`packages/webview-shell`](packages/webview-shell),
while the GPL-licensed Bones host and its adapter live under
[`apps/commits`](apps/commits). The adapter is compiled to a WebAssembly
component and runs the same Git Graph webview used by the extension in a wry
panel.

Phases 0 and 1 provide the walking skeleton: the native app, TypeScript guest
toolchain, shared binary codec, `HostPort`, VS Code page API shim, and a typed
echo round trip. Real Git behavior starts in Phase 2.

## Prerequisites

- Rust 1.94 or later
- Node.js 22 or later and npm
- CMake and Ninja
- A working C/C++ toolchain
- WebView2 on Windows

Initialize the nested bones dependencies after cloning:

```powershell
git submodule update --init --recursive
npm install
```

On Windows ARM64, `npm run build` bootstraps a repository-local `wizer`
10.0.0 because the upstream npm package has no prebuilt ARM64 executable.
That first build is slow; later builds reuse `.tools/wizer/bin/wizer.exe`.

## Build and test

```powershell
npm run build
npm run verify
```

Each part builds on its own, so an unchanged part is never rebuilt. The host is
the slow one because it compiles the vendored engine; the page is the fast loop.

| Target | Rebuilds | Run it after changing |
| --- | --- | --- |
| `npm run build:web` | page bundle and markup | `apps/commits/web`, `packages/webview-shell` |
| `npm run build:wasm` | the WebAssembly components | `apps/commits/bones-adapter`, `packages/core` |
| `npm run build:host` | the native executables | `apps/commits/host`, `crates/`, `vendor/bones` |

`npm run dist:web`, `dist:wasm` and `dist:host` refresh the matching part of
`dist/app` in place. `npm run clean` is the only thing that removes output.

Assemble a runnable release directory:

```powershell
npm run dist
.\dist\app\commits.exe
```

The packaged app opens the Git Graph table and branch sidebar. If no repository
was restored, its Bones-specific overlay lets you choose or enter one.

The repository splits by who can use the code: [`packages/`](packages) holds
what the VS Code extension consumes, [`apps/`](apps) holds this application, and
each directory's README states what belongs in it.

Architecture and current verification evidence are indexed in
[`docs/index.md`](docs/index.md).
