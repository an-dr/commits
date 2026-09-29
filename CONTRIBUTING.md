# Contributing to Commits

Thanks for helping improve Commits. Bug reports, documentation fixes, tests, design feedback, and code changes all matter. You do not need to use AI tools to participate.

Commits is an **AI-driven project**, and AI-assisted contributions are welcome. A **human reviews every contribution** before acceptance. If you use AI, review its output yourself, run the relevant checks, and be ready to explain the change and its tradeoffs. The same review standard applies to every pull request.

## Find a place to start

- Try the [latest release](https://github.com/an-dr/commits/releases/latest) and report a reproducible problem in [issues](https://github.com/an-dr/commits/issues).
- Improve a confusing step in the [README](README.md) or [documentation](docs/index.md).
- Browse [open issues](https://github.com/an-dr/commits/issues) for a focused change. For a larger proposal, open an issue first so the direction can be discussed.

Describe what you expected, what happened, your operating system, and the steps to reproduce a bug. Include a small sample repository or log excerpt when it helps; remove private paths and credentials before posting.

## Build from source

Clone with the Bones submodule:

```sh
git clone --recurse-submodules https://github.com/an-dr/commits.git
cd commits
```

If you already cloned without submodules, run `git submodule update --init --recursive` in the repository root.

### Linux with Docker

Docker provides the same toolchain used by CI. From the repository root, run:

```sh
scripts/ci-docker.sh linux-x64
```

The first build downloads the image and dependencies and takes longer. The script builds the app, runs the Linux checks, and packages a ZIP in `release/`. See [CI and cross-platform builds](docs/ci.md) for Windows cross-build targets and details.

Running that build on the host requires GTK 3, WebKitGTK 4.1, AppIndicator, librsvg, ALSA, Xss, and OpenSSL runtime libraries; the [CI image](ci/Dockerfile) lists the corresponding Ubuntu packages. Docker supplies the build dependencies inside the container, but the desktop app uses the host's libraries when launched outside it.

```sh
./dist/app/commits
```

### Native Linux build

A native build needs Node.js, Rust, PowerShell 7, CMake, Ninja, `pkg-config`, a C/C++ toolchain, and the GTK 3 and WebKitGTK 4.1 development libraries. The [CI image](ci/Dockerfile) is the exact Ubuntu 24.04 dependency list. After installing them, run `npm install` and `pwsh scripts/dist.ps1` from the repository root; the launcher is `./dist/app/commits`.

### Native Windows build

Install Rust, Node.js 22.12 or later with npm, CMake, Ninja, and the Visual Studio C++ build tools with the Windows SDK. Use Node 22.23.2 for Windows ARM64 builds, matching the [CI image](ci/Dockerfile). WebView2 is also required to run the app. The Rust toolchain and Visual Studio tools can be installed with:

```powershell
winget install --id Rustlang.Rustup -e
winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--quiet --wait --norestart --nocache --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

After installing the other prerequisites, open a new PowerShell session in the repository root:

```powershell
npm install
npm run dist
.\dist\app\commits.exe
```

The first native build compiles the Bones engine and can take a while. Windows ARM64 builds bootstrap a repository-local `wizer` on the first run. For a partial rebuild, use `npm run dist:web`, `npm run dist:wasm`, or `npm run dist:host` according to the part you changed.

## Understand the repository

| Area | What belongs there |
| --- | --- |
| [`apps/commits/host`](apps/commits/host/README.md) | Native process, operating system integration, and app lifetime |
| [`apps/commits/bones-adapter`](apps/commits/bones-adapter/README.md) | WebAssembly guest and Bones bridge |
| [`apps/commits/web`](apps/commits/web/README.md) | Desktop webview and styles |
| [`packages/`](packages/README.md) | Shared core and webview shell |
| [`crates/`](crates/README.md) | Reusable native capabilities |
| [`docs/`](docs/index.md) | Architecture decisions and feature documentation |

The [roadmap](ROADMAP.md) gives product direction. Please treat [`vendor/bones`](vendor/bones/README.md) as upstream code: changes to general engine behavior belong in the Bones project, as described in [ADR-003](docs/adr/ADR-003-treat-vendored-bones-as-read-only-upstream.md).

## Check your change

Run the checks relevant to your files before opening a pull request. Build the WebAssembly components before Rust tests, since the host's component-load test reads them from `dist/extensions/`:

```sh
npm run check
npm test
npm run build:wasm
cargo test --workspace
```

For a full local build and verification, run `npm run verify`. On Linux, `scripts/ci-docker.sh linux-x64` is the supported way to run the full build and checks with CI's dependencies. A documentation-only change needs its links, commands, and claims checked against the files they describe; a full native build is not needed for prose alone.

## Send a pull request

1. Fork the repository and create a branch for one focused change.
1. Explain the problem, what changed, and how you checked it. Add screenshots for visible UI changes when useful.
1. Link an issue if one exists and mention any known limitation or follow-up.
1. Respond to review feedback. A human maintainer reviews the contribution before it is accepted.

If you are unsure where a change belongs or a check fails for reasons unrelated to your work, say so in the pull request. Clear context helps reviewers and other contributors help you.
