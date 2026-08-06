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
- Node.js 22.12 or later and npm
- CMake and Ninja
- A working C/C++ toolchain
- WebView2 on Windows

Nothing here is bundled, and a machine that has never built native Rust is
missing most of it. On a fresh Windows box the two that actually stop the build
are Rust and the MSVC toolchain, and neither failure names itself clearly:
without Rust, `npm run build:host` reports an unknown `cargo`; without MSVC,
`cargo` reports a missing `link.exe`. Install both up front:

```powershell
# Rust, per user, no administrator rights needed
winget install --id Rustlang.Rustup -e

# MSVC compiler, linker and the Windows SDK, needed by the
# x86_64-pc-windows-msvc target and the vendored engine's CMake build.
# Requires administrator rights and downloads several gigabytes.
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override `
  "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

Verify before building, because a partial toolchain fails deep into a long
compile rather than at the start. Each of these must print a path:

```powershell
(Get-Command cargo).Source
(Get-Command cmake).Source
(Get-Command ninja).Source
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

Node must be 22.12 or later: `vitest` pulls in `vite` and `rolldown`, which
refuse anything earlier. `npm install` only warns about this, then `npm test`
fails, so it is easy to mistake for a broken checkout.

WebView2 ships with current Windows 11. Confirm it, since the app opens an
empty window without it:

```powershell
(Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}").pv
```

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

## Troubleshooting a blank window

A window that opens black, with no menu bar, means the `commits` component
failed to attach. The engine treats that as non-fatal -- it logs the error and
keeps ticking -- so nothing ever opens the panel. The app now reports this in a
dialog and writes `commits.log` beside the executable; the previous run is kept
as `commits.prev.log`, because relaunching is the first thing anyone tries.

```powershell
Get-Content .\dist\app\commits.log
```

The line to look for is:

```text
[ERROR] engine: failed to load ...\extensions\commits.wasm: error while executing at wasm backtrace: ... init
```

This is a timing failure, not a broken build. `instantiate` plus `init` must
finish inside a wall-clock budget, and `commits.wasm` is roughly 12 MB carrying
an embedded JavaScript engine. Because the budget is wall clock, it is spent by
any delay at all, not only by work: a busy machine, a first run where the file
is not in the page cache and a virus scanner is still reading a newly written
12 MB binary, or a launch straight after `npm run dist`.

The engine's default budget of one second was too tight for this component --
under heavy CPU load it failed every launch, while the same bytes loaded every
time on an idle machine. The app therefore asks for thirty seconds through
`Engine::extension_load_timeout` in
[`apps/commits/host/src/main.rs`](apps/commits/host/src/main.rs); the same load
that used to fail four times out of four now succeeds four times out of four.

If you still see this, the machine is slower than that allowance rather than
misconfigured: raise the value there. Relaunching on a quiet machine also
works.

The repository splits by who can use the code: [`packages/`](packages) holds
what the VS Code extension consumes, [`apps/`](apps) holds this application, and
each directory's README states what belongs in it.

Architecture and current verification evidence are indexed in
[`docs/index.md`](docs/index.md).
