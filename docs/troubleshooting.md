# Troubleshooting

## The window is blank or black

If the window opens without the graph, check the startup dialog and `commits.log`. For an extracted release or local build, the log is beside the app executable; for an installed app, it is in the shared install directory. The previous run's log is kept as `commits.prev.log`. For a local Windows build:

```powershell
Get-Content .\dist\app\commits.log
```

For an extracted release, look in the folder containing `commits-app.exe` or `commits-app`. An error mentioning `components/commits.wasm` means the WebAssembly component did not load. Relaunch on an idle machine; if the problem repeats, [open an issue](https://github.com/an-dr/commits/issues) with your operating system, app version, reproduction steps, and the relevant log lines. Remove private paths and credentials before sharing a log.

The host allows 30 seconds for the component to load. The [technical debt record](techdebt.md) and [Linux startup investigation](linux-startup-investigation.md) explain the known startup cases and their history.

## A repository does not open

Pass a Git repository, or a directory containing repositories, to the app. Relative paths are resolved from the terminal's current directory. If the path is missing or not usable, the repository chooser reports the reason. Starting without a path opens the chooser, where recent repositories are available.

## A local build fails

Check that submodules were initialized with `git submodule update --init --recursive`. On Windows, make sure Rust, Node.js, CMake, Ninja, the Visual Studio C++ tools, and WebView2 are installed; the [build guide](../CONTRIBUTING.md#build-from-source) lists the setup. On Linux, the [Docker build](ci.md#running-a-build-locally) uses CI's pinned toolchain and native libraries.

### Check the Windows toolchain

From a new PowerShell session, each command should print a path (or a version for Node):

```powershell
(Get-Command cargo).Source
(Get-Command cmake).Source
(Get-Command ninja).Source
node --version
& "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe" `
  -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
```

The Visual Studio check confirms that the C++ compiler and linker are installed. A missing `cargo` usually means Rust is absent or the shell has not been reopened since installation; a missing `link.exe` points to the Visual Studio C++ workload. Node.js must be 22.12 or later for the test toolchain: `npm install` may only warn on an older version, while `npm test` then fails. The [CI image](../ci/Dockerfile) uses Node 22.23.2 for builds across all targets.

WebView2 is needed to display the app on Windows. To check its installation:

```powershell
(Get-ItemProperty "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}").pv
```

### Clear an old nested submodule

Clones made before the Bones 1.0 pin can retain a nested `agents` submodule that is no longer part of the checkout. If `git submodule update` reports `unable to rmdir agents: Directory not empty`, run these commands from the repository root:

```powershell
Remove-Item -Recurse -Force vendor\bones\agents -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force .git\modules\vendor\bones\modules\agents -ErrorAction SilentlyContinue
git -C vendor\bones config --remove-section submodule.agents
```

The last command may report `no such section` when there is nothing left to clear.
