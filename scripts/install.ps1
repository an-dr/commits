<#
.SYNOPSIS
Installs the standalone app to ~/.commits/app, or pushes a new version
folder there if it is already installed.

.DESCRIPTION
A fresh install copies commits.exe (the permanent entry point) to
~/.commits/app itself and everything else into a version-named folder
underneath it, then points Start Menu and desktop shortcuts at commits.exe
-- it applies whichever version folder is current before commits-app.exe
(the real app logic) starts, so shortcuts must never target commits-app.exe
directly. Running this script again once installed does not touch the live
install: it pushes the build into its own new version folder, exactly as if
Update had been clicked in the app, so a second run is how a from-source
build gets "pushed" without waiting on a hosted manifest. Only the current
and previous version folders are kept; older ones are deleted.

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
# was ever run directly out of -Source accumulates WebView2's own per-exe
# browser profile, the bones save-slot directory, and log files right next
# to the real app -- none of that is part of the distributable app, and a
# WebView2 profile can hold files open if that exe is still running,
# aborting a blind recursive copy partway through.
function Test-RuntimeArtifact([string]$Name) {
    return $Name -like "*.WebView2" -or $Name -ieq "saves" -or $Name -like "*.log"
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

# Reads the standalone app's own version straight from its Cargo.toml, the
# same value baked into the built commits-app.exe as CARGO_PKG_VERSION --
# this script has no other reliable way to name the version folder it is
# about to create.
function Get-AppVersion([string]$RepoRoot) {
    $cargoToml = Join-Path $RepoRoot "apps/commits/host/Cargo.toml"
    $content = Get-Content -LiteralPath $cargoToml -Raw
    if ($content -match '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"') {
        return $Matches[1]
    }
    throw "Could not read the app version from $cargoToml"
}

# Copies $From (a built app directory) into a new version folder under
# $InstallDir, mirroring commits_upgrader::extract_version /
# copy_version_from_dir (Rust) exactly: the launcher exe never becomes part
# of a version folder, "extensions" entries are merged into the shared
# $InstallDir/extensions folder instead of duplicated per version, and a
# version-string collision (typically a dev build that never bumps its
# version) is disambiguated with a short content hash rather than
# overwriting whatever is already there. Prunes anything beyond the current
# and previous version once the push succeeds.
function Install-VersionFolder([string]$From, [string]$InstallDir, [string]$Version) {
    $extensionsSource = Join-Path $From "extensions"
    if (Test-Path -LiteralPath $extensionsSource -PathType Container) {
        Copy-AppFiles -From $extensionsSource -To (Join-Path $InstallDir "extensions")
    }

    $versionDir = Join-Path $InstallDir $Version
    if (Test-Path -LiteralPath $versionDir) {
        $mainExe = Join-Path $From "commits-app.exe"
        $hash = (Get-FileHash -LiteralPath $mainExe -Algorithm SHA256).Hash.Substring(0, 8).ToLowerInvariant()
        $versionDir = Join-Path $InstallDir "$Version-$hash"
    }
    New-Item -ItemType Directory -Path $versionDir -Force | Out-Null
    Get-ChildItem -LiteralPath $From -Force | Where-Object {
        -not (Test-RuntimeArtifact $_.Name) -and $_.Name -ne $launcherName -and $_.Name -ne "extensions"
    } | ForEach-Object {
        $target = Join-Path $versionDir $_.Name
        if ($_.PSIsContainer) {
            Copy-AppFiles -From $_.FullName -To $target
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }

    Remove-OldVersions -InstallDir $InstallDir
    return $versionDir
}

# Keeps only the two most recently installed version folders under
# $InstallDir (the current version and one fallback), deleting the rest --
# the same retention commits_upgrader::install (Rust) applies after every
# extract/copy. Matched by name so commits.exe, updater/, extensions/, and
# saves/ are never mistaken for a version folder.
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
$version = Get-AppVersion -RepoRoot (Split-Path -Parent $PSScriptRoot)

if (Test-Path -LiteralPath (Join-Path $installDir $launcherName)) {
    # Already installed: never overwrite a possibly-running install
    # directly. Push this build as a new version folder, exactly like a
    # downloaded update -- the launcher picks it up as current the next
    # time it starts, simply because it is the newest version folder there.
    $versionDir = Install-VersionFolder -From $Source -InstallDir $installDir -Version $version
    Write-Host "$installDir is already installed; pushed this build to $versionDir."
    Write-Host "It applies the next time commits.exe (the launcher) starts."
    exit 0
}

New-Item -ItemType Directory -Path $installDir -Force | Out-Null
Copy-Item -LiteralPath (Join-Path $Source $launcherName) -Destination (Join-Path $installDir $launcherName) -Force
Install-VersionFolder -From $Source -InstallDir $installDir -Version $version | Out-Null
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
