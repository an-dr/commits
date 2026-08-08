<#
.SYNOPSIS
Assembles the runnable app in dist/app, one part at a time.

.DESCRIPTION
Each part is independent so an unchanged part keeps its existing build. The
host part is the expensive one because it compiles the vendored bones engine;
web and wasm are the fast loops.

dist/app is assembled already in the shape an install uses: commits.exe (the
launcher) at the root, the other host executables and page.html in a version
folder named after apps/commits/host/Cargo.toml's own version, and
components/ shared alongside it. That keeps '.\dist\app\commits.exe'
(docs/phase-0-1.md) working directly out of a fresh build, and lets
install.ps1 install/push dist/app's contents largely as-is instead of having
to re-derive the version and re-split files itself.

.PARAMETER Part
web   page bundle and markup only
wasm  the WebAssembly components only
host  the native executables only
all   every part (default)
#>
param(
    [ValidateSet("web", "wasm", "host", "all")]
    [string]$Part = "all"
)

$ErrorActionPreference = "Stop"
$isWindowsPlatform = $env:OS -eq "Windows_NT"

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "dist/app"
$rootFull = [IO.Path]::GetFullPath($root)
$outputFull = [IO.Path]::GetFullPath($output)
if (-not $outputFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to write an output directory outside the repository"
}

$node = (Get-Command node -ErrorAction Stop).Source
$npmCli = Join-Path (Split-Path -Parent $node) "node_modules/npm/bin/npm-cli.js"

function Invoke-Npm {
    param([Parameter(Mandatory)][string]$Script)
    if (Test-Path -LiteralPath $npmCli) { & $node $npmCli run $Script } else { npm run $Script }
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

# Reads the standalone app's own version straight from its Cargo.toml, the
# same value baked into the built commits-app.exe as CARGO_PKG_VERSION --
# this script has no other reliable way to name the version folder it is
# about to assemble.
function Get-AppVersion([string]$RepoRoot) {
    $cargoToml = Join-Path $RepoRoot "apps/commits/host/Cargo.toml"
    $content = Get-Content -LiteralPath $cargoToml -Raw
    if ($content -match '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"') {
        return $Matches[1]
    }
    throw "Could not read the app version from $cargoToml"
}

$version = Get-AppVersion -RepoRoot $root
$versionDirFull = Join-Path $outputFull $version

New-Item -ItemType Directory -Path (Join-Path $outputFull "components") -Force | Out-Null
New-Item -ItemType Directory -Path $versionDirFull -Force | Out-Null

if ($Part -in @("web", "all")) {
    Invoke-Npm "build:web"
    Copy-Item (Join-Path $root "dist/ui/page.html") (Join-Path $versionDirFull "page.html") -Force
    Write-Host "Updated the page in $versionDirFull"
}

if ($Part -in @("wasm", "all")) {
    Invoke-Npm "build:wasm"
    foreach ($component in @("commits", "hello")) {
        Copy-Item (Join-Path $root "dist/extensions/$component.wasm") `
            (Join-Path $outputFull "components/$component.wasm") -Force
    }
    Write-Host "Updated the components in $outputFull/components"
}

if ($Part -in @("host", "all")) {
    cargo build --release -p commits-app
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    # "commits" is the launcher -- the permanent entry point that picks the
    # current version folder before running the real app logic, built
    # separately as "commits-app". Shortcuts and manual launches always
    # target this one, and it stays at dist/app's root, never inside the
    # version folder.
    $exe = if ($isWindowsPlatform) { "commits.exe" } else { "commits" }
    Copy-Item (Join-Path $root "target/release/$exe") (Join-Path $outputFull $exe) -Force
    foreach ($helper in @("commits-askpass", "commits-editor", "commits-app")) {
        $helperExe = if ($isWindowsPlatform) { "$helper.exe" } else { $helper }
        Copy-Item (Join-Path $root "target/release/$helperExe") (Join-Path $versionDirFull $helperExe) -Force
    }
    Write-Host "Updated the executables in $outputFull ($versionDirFull for the versioned parts)"
}

Write-Host "Runnable app assembled at $outputFull"
