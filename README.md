# commits

A standalone desktop Git client built on the
[`bones`](vendor/bones) engine. The repository contains an unchanged MIT
snapshot of `@an-dr/commits-core` in [`packages/core`](packages/core) and a
reusable MIT webview shell in [`packages/webview-shell`](packages/webview-shell),
while the GPL-licensed Bones host and its adapter remain in [`core`](core).
The adapter is compiled to a WebAssembly component and runs the same Git Graph
webview used by the extension in a wry panel.

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
cargo build
npm run verify
```

Assemble a runnable release directory:

```powershell
npm run dist
.\dist\app\commits.exe
```

The packaged app opens the Git Graph table and branch sidebar. If no repository
was restored, its Bones-specific overlay lets you choose or enter one.

Architecture and current verification evidence are indexed in
[`docs/index.md`](docs/index.md).
