# Continuous integration

Every platform builds inside one Docker image, [`ci/Dockerfile`](../ci/Dockerfile),
so a build on this machine and a build on GitHub Actions run the same tools
in the same versions. The image is Ubuntu 24.04 with Node, PowerShell, Rust,
the GTK/WebKit libraries the Linux app links, and a cross-compiler for both
Windows targets.

## Running a build locally

```sh
scripts/ci-docker.sh linux-x64        # or windows-x64, windows-arm64
```

It builds the image, then runs
[`scripts/ci-build.ps1`](../scripts/ci-build.ps1) in a container with the
repository mounted at `/work`, as your own user so every file it writes stays
yours. `ci-build.ps1` is the whole job: it installs the npm packages, builds
the page and the wasm components, builds the host executables, runs the
checks and tests (Linux only, see below), assembles `dist/app`, and packages
the release zip and manifest into `release/`.

A second argument names a release tag, exactly as CI passes it:

```sh
scripts/ci-docker.sh windows-x64 v1.8.0
```

Downloads that are the same on every run — the cargo registry and the Windows
SDK — are cached under `~/.cache/commits-ci` (override with
`COMMITS_CI_CACHE`). A build starts by removing `dist/app`'s current version
folder, because the three platforms assemble into the same place and a
leftover Linux binary must never end up in a Windows zip.

## Windows from Linux

The Windows executables are cross-compiled with
[cargo-xwin](https://github.com/rust-cross/cargo-xwin), which downloads the
Microsoft C runtime and Windows SDK headers and libraries and compiles with
clang. Downloading them means accepting Microsoft's license for them; the
build does that by setting `XWIN_ACCEPT_LICENSE=1`.

Two details of the image exist only for this:

- **clang 19, not Ubuntu's default 18.** clang 18's built-in `__prefetch`
  conflicts with the SDK's `intrin.h` on arm64, and `zstd-sys` stops there.
- **A `clang` wrapper,** [`ci/clang-wrapper`](../ci/clang-wrapper). cargo-xwin
  passes MSVC-style include flags (`/imsvc DIR`) to every C compiler, and
  `ring` builds Windows arm64 with plain clang, which rejects them. The
  wrapper rewrites that flag to `-isystem DIR` when called as `clang`, and
  passes everything through when called as `clang-cl`.

## Tests

The JavaScript and Rust tests run in the `linux-x64` container. A Windows
binary cannot run in a Linux container, so the cross-compiled builds are
compiled but not executed there. One job outside Docker covers that gap: on a
`windows-latest` runner it runs `cargo test --workspace` natively, against
the wasm components the Linux job built, so Windows-only code is still
exercised on every push.

## The workflow

[`.github/workflows/build.yml`](../.github/workflows/build.yml) has three
jobs:

| Job | Runs on | Does |
| --- | --- | --- |
| `build` | `ubuntu-latest`, once per platform | `scripts/ci-docker.sh <platform> <tag>` and uploads `release/` |
| `windows-tests` | `windows-latest` | `cargo test --workspace` against the Linux job's components |
| `release` | `ubuntu-latest`, `v*` tags only | publishes the three zips and manifests; see [`updating.md`](updating.md#publishing-a-release) |
