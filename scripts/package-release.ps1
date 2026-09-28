<#
.SYNOPSIS
Packages dist/app's current version folder as a release zip and its manifest.

.DESCRIPTION
Run after scripts/dist.ps1. Writes two files to release/:

  commits-<version>-<platform>.zip   the version folder's contents, the
                                      payload the app's updater extracts
  commits-<platform>.json            the manifest the app reads from the
                                      latest release (docs/updating.md)

The manifest's url points at the zip on the tag's GitHub release, so the two
must be published together.

.PARAMETER Platform
The build type: windows-x64, windows-arm64 or linux-x64. It must match the
app's own compile-time platform (apps/commits/host/src/release.rs), since
that is the manifest name the app asks for.

.PARAMETER Tag
The release tag. Defaults to v<version>; when given it must equal that,
because a manifest naming another version would never be offered.

.PARAMETER Repository
owner/name on GitHub. Defaults to an-dr/commits.
#>
param(
    [Parameter(Mandatory)]
    [ValidateSet("windows-x64", "windows-arm64", "linux-x64")]
    [string]$Platform,
    [string]$Tag = "",
    [string]$Repository = "an-dr/commits"
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

$root = Split-Path -Parent $PSScriptRoot
$cargoToml = Get-Content -LiteralPath (Join-Path $root "apps/commits/host/Cargo.toml") -Raw
if ($cargoToml -notmatch '(?m)^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"') {
    throw "Could not read the app version from apps/commits/host/Cargo.toml"
}
$version = $Matches[1]

if ($Tag -eq "") {
    $Tag = "v$version"
} elseif ($Tag -ne "v$version") {
    throw "Tag '$Tag' does not match the app version $version; tag v$version instead, or bump the version first"
}

$versionDir = Join-Path $root "dist/app/$version"
foreach ($required in @("page.html", "components", "LICENSE")) {
    if (-not (Test-Path -LiteralPath (Join-Path $versionDir $required))) {
        throw "dist/app/$version has no $required; run scripts/dist.ps1 first"
    }
}

$output = Join-Path $root "release"
New-Item -ItemType Directory -Path $output -Force | Out-Null

$zipName = "commits-$version-$Platform.zip"
$zipPath = Join-Path $output $zipName
Remove-Item -LiteralPath $zipPath -Force -ErrorAction SilentlyContinue
# Entries sit at the zip's root, not under a folder: the updater extracts the
# archive straight into the new version folder.
[IO.Compression.ZipFile]::CreateFromDirectory($versionDir, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)

$sha256 = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = [ordered]@{
    version = $version
    url     = "https://github.com/$Repository/releases/download/$Tag/$zipName"
    sha256  = $sha256
}
$manifestPath = Join-Path $output "commits-$Platform.json"
$manifest | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM

Write-Host "Packaged $zipPath ($([math]::Round((Get-Item $zipPath).Length / 1MB, 1)) MB)"
Write-Host "Wrote $manifestPath for $Tag"
