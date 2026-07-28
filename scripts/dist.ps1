$ErrorActionPreference = "Stop"

npm run build
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

cargo build --release -p commits-app
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

$root = Split-Path -Parent $PSScriptRoot
$output = Join-Path $root "dist/app"
$rootFull = [IO.Path]::GetFullPath($root)
$outputFull = [IO.Path]::GetFullPath($output)
if (-not $outputFull.StartsWith($rootFull + [IO.Path]::DirectorySeparatorChar)) {
    throw "Refusing to replace an output directory outside the repository"
}

if (Test-Path -LiteralPath $outputFull) {
    Remove-Item -LiteralPath $outputFull -Recurse -Force
}

New-Item -ItemType Directory -Path (Join-Path $outputFull "extensions") -Force | Out-Null
$exe = if ($IsWindows) { "commits.exe" } else { "commits" }
Copy-Item (Join-Path $root "target/release/$exe") (Join-Path $outputFull $exe)
foreach ($helper in @("commits-askpass", "commits-editor")) {
    $helperExe = if ($IsWindows) { "$helper.exe" } else { $helper }
    Copy-Item (Join-Path $root "target/release/$helperExe") (Join-Path $outputFull $helperExe)
}
Copy-Item (Join-Path $root "dist/extensions/commits.wasm") (Join-Path $outputFull "extensions/commits.wasm")
Copy-Item (Join-Path $root "dist/extensions/hello.wasm") (Join-Path $outputFull "extensions/hello.wasm")

Write-Host "Runnable app assembled at $outputFull"
