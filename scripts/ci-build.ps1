<#
.SYNOPSIS
The whole CI job for one platform, run inside the ci/Dockerfile image.

.DESCRIPTION
scripts/ci-docker.sh runs this in the container, locally and on GitHub
Actions alike (docs/ci.md). It builds the page, the wasm components and the
host executables, runs the checks and tests on linux-x64, and packages the
release zip and manifest into release/.

.PARAMETER Platform
windows-x64, windows-arm64 or linux-x64.

.PARAMETER Tag
The release tag, passed on to package-release.ps1; empty outside a release.
#>
param(
    [Parameter(Mandatory)]
    [ValidateSet("windows-x64", "windows-arm64", "linux-x64")]
    [string]$Platform,
    [string]$Tag = ""
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$targets = @{
    "linux-x64"     = ""
    "windows-x64"   = "x86_64-pc-windows-msvc"
    "windows-arm64" = "aarch64-pc-windows-msvc"
}

# Each step is announced by name, so a failure in a long log says where it
# happened, and fails the job with the step's own exit code.
function Step([string]$Name, [scriptblock]$Command) {
    Write-Host "::group::$Name"
    & $Command
    $code = $LASTEXITCODE
    Write-Host "::endgroup::"
    if ($code -ne 0) {
        Write-Host "::error::$Name failed with exit code $code"
        exit $code
    }
}

$cargoToml = Get-Content -LiteralPath "apps/commits/host/Cargo.toml" -Raw
if ($cargoToml -notmatch '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"') {
    throw "Could not read the app version from apps/commits/host/Cargo.toml"
}
# The platforms assemble into the same folder; a leftover from another one
# must never be packaged into this one's zip.
Remove-Item -LiteralPath "dist/app/$($Matches[1])" -Recurse -Force -ErrorAction SilentlyContinue

# Not `npm ci`: optional native dependencies are platform-gated, so a
# lockfile resolved on one OS is not guaranteed complete for another.
Step "npm install" { npm install --no-audit --no-fund }
Step "Build the page" { ./scripts/dist.ps1 -Part web }
Step "Build the wasm components" { ./scripts/dist.ps1 -Part wasm }
Step "Build the host executables" { ./scripts/dist.ps1 -Part host -Target $targets[$Platform] }

# A cross-compiled Windows binary cannot run here; the windows-tests job
# runs the Rust tests natively instead (docs/ci.md).
if ($Platform -eq "linux-x64") {
    Step "npm run check" { npm run check }
    Step "npm test" { npm test }
    Step "cargo test" { cargo test --workspace }
}

Step "Package the release" { ./scripts/package-release.ps1 -Platform $Platform -Tag $Tag }
