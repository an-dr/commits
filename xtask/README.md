# Build automation

`cargo xtask` owns native build orchestration for Commits. npm owns the page and WebAssembly component builds; the task runner calls those existing commands rather than duplicating them. The repository's Bones task runner builds the engine itself and is not used to package Commits.

Run `cargo xtask doctor` to check the build prerequisites, and `cargo xtask test` to run the workspace tests; arguments such as `-p xtask` replace the default `--workspace` and go to `cargo test`. Missing tools are reported with setup guidance; the command installs nothing. Native Windows tasks load the installed Visual Studio C++ environment when SDK headers are absent, even if clang is already on PATH.

On Windows ARM64, the first component build also loads that environment before the npm builder bootstraps its repository-local Wizer. A cached Wizer keeps subsequent component rebuilds independent of native compilation.

The runner reads the app version and Cargo target directory through `cargo metadata`, so staging follows the same package manifest and output directory as Cargo.

`cargo xtask dist` builds and assembles `dist/app`. Use `--part web`, `--part wasm`, or `--part host` for a partial rebuild, and `--target <triple>` to cross-compile. Windows targets built from Linux use `cargo xwin`; native Windows builds use Cargo with the installed MSVC tools. The npm `dist` commands are shortcuts to these tasks.

The launcher is `dist/app/commits.exe` on Windows or `dist/app/commits` on Linux. The app, helper executables, launcher payload, page, components and license notices live inside `dist/app/<app-version>/`. Partial builds preserve the other parts.

`cargo xtask package-release --platform windows-arm64` packages an already assembled payload. Platforms are `windows-x64`, `windows-arm64`, and `linux-x64`; `--tag v<version>` must match the app version, and `--repository owner/name` overrides `an-dr/commits`. The task writes the ZIP and updater manifest to `release/`, validates required payload files, omits runtime state and logs, and preserves Linux executable permissions.

`cargo xtask ci --platform <platform> [--tag v<version>]` runs the container job: clear the current generated version folder, install npm packages, build all parts, run checks and tests on Linux x64, then package the release. `scripts/ci-docker.sh` supplies the image and mounts; it calls this same task locally and on GitHub Actions. PowerShell is not needed in the build container.

The CI image uses `linux/amd64` for all three targets, including when Docker runs on an ARM64 host. This matches its Node download, Linux package target and Windows cross-toolchain.

`cargo xtask wire-types` regenerates `ipc/ts/bones-messages.ts` from the pinned bones wire format; see the [wire contract](../ipc/README.md).

Historical ADRs retain the script names used when those decisions were made. Current build and packaging commands are owned by this page and the [contribution guide](../CONTRIBUTING.md).
