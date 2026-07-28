# commits

A standalone desktop Git client built on the
[`bones`](vendor/bones) engine. The product core is TypeScript compiled to a
WebAssembly component; the page UI is ordinary browser TypeScript hosted in a
wry panel.

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

The page reports its bones connection and offers an echo field. Submitting it
proves the browser → WASM core → bones web module → browser round trip.

Architecture and current verification evidence are indexed in
[`docs/index.md`](docs/index.md).
