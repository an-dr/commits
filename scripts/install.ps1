<#
.SYNOPSIS
Installs the standalone app to ~/.commits/app, or pushes a new version
folder there if it is already installed.

.DESCRIPTION
dist.ps1 already assembles -Source in the shape an install uses: commits.exe
at its root, a single version folder, and components/ shared alongside it
(see dist.ps1's own doc comment). A fresh install copies that shape as-is
into ~/.commits/app and points Start Menu and desktop shortcuts at
commits.exe -- it applies whichever version folder is current before
commits-app.exe (the real app logic) starts, so shortcuts must never target
commits-app.exe directly. Running this script again once installed does not
touch the live install: it pushes -Source's version folder into its own new
version folder, exactly as if Update had been clicked in the app, so a
second run is how a from-source build gets "pushed" without waiting on a
hosted manifest. Only the current and previous version folders are kept;
older ones are deleted.

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

# Mirrors commits_upgrader::install::is_runtime_artifact (Rust): a build that
# was ever run directly out of a version folder accumulates WebView2's own
# per-exe browser profile, the bones state-slot directory, and log files
# right next to the real app -- none of that is part of the distributable
# app, and a WebView2 profile can hold files open if that exe is still
# running, aborting a blind recursive copy partway through.
function Test-RuntimeArtifact([string]$Name) {
    return $Name -like "*.WebView2" -or $Name -ieq "state" -or $Name -like "*.log"
}

function Copy-AppFiles([string]$From, [string]$To) {
    New-Item -ItemType Directory -Path $To -Force | Out-Null
    Get-ChildItem -LiteralPath $From -Force | Where-Object { -not (Test-RuntimeArtifact $_.Name) } | ForEach-Object {
        $target = Join-Path $To $_.Name
        if ($_.PSIsContainer) {
            Copy-AppFiles -From $_.FullName -To $target
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }
}

# The single version folder dist.ps1 assembled under $Source -- everything
# else there (commits.exe, components/) is already in the shape an install
# uses and can be copied as-is.
function Get-SourceVersionDir([string]$Source) {
    $versionDirs = @(Get-ChildItem -LiteralPath $Source -Directory -Force | Where-Object {
        $_.Name -match '^[0-9]+(\.[0-9]+)*(-[0-9a-f]+)?$'
    })
    if ($versionDirs.Count -ne 1) {
        throw "$Source must contain exactly one version folder (found $($versionDirs.Count)); rebuild with 'npm run dist'."
    }
    return $versionDirs[0]
}

# Pushes $Source's version folder into $InstallDir, disambiguating a
# version-string collision (typically a dev build that never bumps its
# version) with a short content hash, merging $Source/components into the
# shared $InstallDir/components folder, and pruning anything beyond the
# current and previous version -- mirroring
# commits_upgrader::extract_version/copy_version_from_dir (Rust) exactly.
function Install-VersionFolder([string]$Source, [string]$InstallDir) {
    $componentsSource = Join-Path $Source "components"
    if (Test-Path -LiteralPath $componentsSource -PathType Container) {
        Copy-AppFiles -From $componentsSource -To (Join-Path $InstallDir "components")
    }

    $sourceVersionDir = Get-SourceVersionDir -Source $Source
    $versionDir = Join-Path $InstallDir $sourceVersionDir.Name
    if (Test-Path -LiteralPath $versionDir) {
        $mainExe = Join-Path $sourceVersionDir.FullName "commits-app.exe"
        $hash = (Get-FileHash -LiteralPath $mainExe -Algorithm SHA256).Hash.Substring(0, 8).ToLowerInvariant()
        $versionDir = Join-Path $InstallDir "$($sourceVersionDir.Name)-$hash"
    }
    Copy-AppFiles -From $sourceVersionDir.FullName -To $versionDir

    Remove-OldVersions -InstallDir $InstallDir
    return $versionDir
}

# Keeps only the two most recently installed version folders under
# $InstallDir (the current version and one fallback), deleting the rest --
# the same retention commits_upgrader::install (Rust) applies after every
# extract/copy. Matched by name so commits.exe, updater/, components/, and
# state/ are never mistaken for a version folder.
function Remove-OldVersions([string]$InstallDir) {
    Get-ChildItem -LiteralPath $InstallDir -Directory -Force |
        Where-Object { $_.Name -match '^[0-9]+(\.[0-9]+)*(-[0-9a-f]+)?$' } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -Skip 2 |
        ForEach-Object { Remove-Item -LiteralPath $_.FullName -Recurse -Force }
}

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

$installDir = $InstallDir

if (Test-Path -LiteralPath (Join-Path $installDir $launcherName)) {
    # Already installed: never overwrite a possibly-running install
    # directly. Push this build as a new version folder, exactly like a
    # downloaded update -- the launcher picks it up as current the next
    # time it starts, simply because it is the newest version folder there.
    $versionDir = Install-VersionFolder -Source $Source -InstallDir $installDir
    Write-Host "$installDir is already installed; pushed this build to $versionDir."
    Write-Host "It applies the next time commits.exe (the launcher) starts."
    exit 0
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Source $launcherName) -Destination (Join-Path $installDir $launcherName) -Force
Install-VersionFolder -Source $Source -InstallDir $installDir | Out-Null
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
