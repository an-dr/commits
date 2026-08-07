<#
.SYNOPSIS
Assembles the runnable app in dist/app, one part at a time.

.DESCRIPTION
Each part is independent so an unchanged part keeps its existing build. The
host part is the expensive one because it compiles the vendored bones engine;
web and wasm are the fast loops.

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

New-Item -ItemType Directory -Path (Join-Path $outputFull "extensions") -Force | Out-Null

if ($Part -in @("web", "all")) {
    Invoke-Npm "build:web"
    Copy-Item (Join-Path $root "dist/ui/page.html") (Join-Path $outputFull "page.html") -Force
    Write-Host "Updated the page in $outputFull"
}

if ($Part -in @("wasm", "all")) {
    Invoke-Npm "build:wasm"
    foreach ($component in @("commits", "hello")) {
        Copy-Item (Join-Path $root "dist/extensions/$component.wasm") `
            (Join-Path $outputFull "extensions/$component.wasm") -Force
    }
    Write-Host "Updated the components in $outputFull"
}

if ($Part -in @("host", "all")) {
    cargo build --release -p commits-app
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
    $exe = if ($isWindowsPlatform) { "commits.exe" } else { "commits" }
    Copy-Item (Join-Path $root "target/release/$exe") (Join-Path $outputFull $exe) -Force
    foreach ($helper in @("commits-askpass", "commits-editor", "commits-launcher")) {
        $helperExe = if ($isWindowsPlatform) { "$helper.exe" } else { $helper }
        Copy-Item (Join-Path $root "target/release/$helperExe") (Join-Path $outputFull $helperExe) -Force
    }
    Write-Host "Updated the executables in $outputFull"
}

Write-Host "Runnable app assembled at $outputFull"
