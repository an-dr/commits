<#
.SYNOPSIS
Installs the standalone app to ~/.commits/app, or stages an update if it is
already installed there.

.DESCRIPTION
A fresh install copies a built app into ~/.commits/app and points Start Menu
and desktop shortcuts at commits.exe -- the permanent entry point that
applies a staged update before commits-app.exe (the real app logic) starts,
so shortcuts must never target commits-app.exe directly. Running this script
again once installed does not touch the live install: it stages the build
into the same updater/update folder the launcher itself applies from,
exactly as if Update had been clicked in the app, so a second run is how a
from-source build gets "pushed" without waiting on a hosted manifest.

.PARAMETER Source
Directory holding a built app (commits.exe, commits-app.exe, ...).
Defaults to dist/app and, if that does not exist yet, builds it first.

.PARAMETER SkipBuild
Fail instead of building when -Source (or the default dist/app) is missing.

.PARAMETER InstallDir
Where a fresh install goes and where an existing install is detected.
Defaults to ~/.commits/app; overriding it is mainly for testing this script
itself without touching a real install.

.PARAMETER NoShortcuts
Skips creating Start Menu / desktop shortcuts on a fresh install. Mainly for
testing this script itself.
#>
param(
    [string]$Source = (Join-Path (Split-Path -Parent $PSScriptRoot) "dist/app"),
    [switch]$SkipBuild,
    [string]$InstallDir = (Join-Path $HOME ".commits/app"),
    [switch]$NoShortcuts
)

$ErrorActionPreference = "Stop"
$isWindowsPlatform = $env:OS -eq "Windows_NT"
$launcherName = if ($isWindowsPlatform) { "commits.exe" } else { "commits" }

if (-not (Test-Path -LiteralPath $Source -PathType Container)) {
    if ($SkipBuild) {
        throw "No built app at $Source."
    }
    Write-Host "No built app at $Source; building it first."
    & (Join-Path $PSScriptRoot "dist.ps1")
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
if (-not (Test-Path -LiteralPath (Join-Path $Source $launcherName))) {
    throw "$Source does not contain $launcherName. Run 'npm run dist' (or drop -SkipBuild) and try again."
}

# Matches commits_upgrader::state_dir() (Rust) exactly: both the launcher and
# this script must agree on where a staged update lives.
$installDir = $InstallDir
$updaterDir = if ($env:COMMITS_UPDATER_DIR) { $env:COMMITS_UPDATER_DIR } else { Join-Path $HOME ".commits/updater" }

if (Test-Path -LiteralPath (Join-Path $installDir $launcherName)) {
    # Already installed: never overwrite a possibly-running install directly.
    # Stage into the same folder the launcher applies from on its next
    # start, exactly like a downloaded update.
    $updateDir = Join-Path $updaterDir "update"
    if (Test-Path -LiteralPath $updateDir) { Remove-Item -LiteralPath $updateDir -Recurse -Force }
    New-Item -ItemType Directory -Path $updateDir -Force | Out-Null
    Copy-Item -Path (Join-Path $Source "*") -Destination $updateDir -Recurse -Force
    Write-Host "$installDir is already installed; staged this build at $updateDir."
    Write-Host "It applies the next time commits.exe (the launcher) starts."
    exit 0
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -Path (Join-Path $Source "*") -Destination $installDir -Recurse -Force
Write-Host "Installed to $installDir"

if ($isWindowsPlatform -and -not $NoShortcuts) {
    $launcherPath = Join-Path $installDir $launcherName
    $shell = New-Object -ComObject WScript.Shell
    foreach ($folder in @("Programs", "Desktop")) {
        $shortcutPath = Join-Path ([Environment]::GetFolderPath($folder)) "Commits.lnk"
        $shortcut = $shell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $launcherPath
        $shortcut.WorkingDirectory = $installDir
        $shortcut.Save()
    }
    Write-Host "Created Start Menu and desktop shortcuts pointing at $launcherPath"
} else {
    Write-Host "Launch $(Join-Path $installDir $launcherName) to start Commits."
}
