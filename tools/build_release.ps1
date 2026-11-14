param([string]$NodeExe, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $projectRoot 'dist' }
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$releaseName = "WuwaMatrixPlanner-v$version-win-x64"
$releaseRoot = Join-Path $OutputDirectory $releaseName
$buildRoot = Join-Path $projectRoot 'build'
[void](New-Item -ItemType Directory -Force -Path $releaseRoot)
[void](New-Item -ItemType Directory -Force -Path $buildRoot)
if (-not $NodeExe) {
    $found = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($found) { $NodeExe = $found.Source }
    else { $NodeExe = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
}
if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { throw 'Node.js executable not found.' }
$licenseSource = Join-Path $projectRoot 'desktop\LICENSE.node.txt'
if (-not (Test-Path -LiteralPath $licenseSource -PathType Leaf)) { throw 'Missing Node.js license: desktop/LICENSE.node.txt' }
$compiler = Join-Path $env:SystemRoot 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { throw '.NET Framework C# compiler not found.' }
$launcher = Join-Path $releaseRoot '终焉矩阵血线排布.exe'
$appIcon = Join-Path $projectRoot 'assets\app\lily.ico'
if (-not (Test-Path -LiteralPath $appIcon -PathType Leaf)) { throw 'Missing app icon: assets/app/lily.ico' }
& $compiler /nologo /codepage:65001 /target:winexe /platform:x64 /optimize+ "/win32icon:$appIcon" "/out:$launcher" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $projectRoot 'desktop\Launcher.cs')
if ($LASTEXITCODE -ne 0) { throw 'Launcher compilation failed.' }
foreach ($name in @('index.html','app.js','styles.css','score-axis.js','plan-library.js','season-config.js','server.mjs','package.json','README.md','THIRD_PARTY_NOTICES.md','CHANGELOG.md')) {
    Copy-Item -LiteralPath (Join-Path $projectRoot $name) -Destination (Join-Path $releaseRoot $name) -Force
}
foreach ($name in @('assets','config')) {
    $destination = Join-Path $releaseRoot $name
    [void](New-Item -ItemType Directory -Force -Path $destination)
    Copy-Item -Path (Join-Path $projectRoot "$name\*") -Destination $destination -Recurse -Force
}
$docsRoot = Join-Path $releaseRoot 'docs'
[void](New-Item -ItemType Directory -Force -Path $docsRoot)
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'docs') -File -Filter '*.md' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $docsRoot -Force }
$dataRoot = Join-Path $releaseRoot 'data'
[void](New-Item -ItemType Directory -Force -Path $dataRoot)
Get-ChildItem -LiteralPath (Join-Path $projectRoot 'data') -File -Filter '*.json' | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $dataRoot -Force }
$runtimeRoot = Join-Path $releaseRoot 'runtime'
[void](New-Item -ItemType Directory -Force -Path $runtimeRoot)
Copy-Item -LiteralPath $NodeExe -Destination (Join-Path $runtimeRoot 'node.exe') -Force
Copy-Item -LiteralPath $licenseSource -Destination (Join-Path $runtimeRoot 'LICENSE.node.txt') -Force
Copy-Item -LiteralPath (Join-Path $projectRoot 'desktop\使用说明.txt') -Destination (Join-Path $releaseRoot '使用说明.txt') -Force
$hashes = @()
Get-ChildItem -LiteralPath $releaseRoot -File -Recurse | Where-Object { $_.Name -ne 'release-manifest.json' } | ForEach-Object {
    $relative = $_.FullName.Substring($releaseRoot.Length + 1).Replace('\','/')
    $hashes += [PSCustomObject]@{ path=$relative; bytes=$_.Length; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
}
$manifest = [PSCustomObject]@{ name='终焉矩阵血线排布'; version=$version; platform='win-x64'; nodeVersion=(& $NodeExe --version); fileCount=$hashes.Count; files=$hashes }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $releaseRoot 'release-manifest.json') -Encoding UTF8
$zipPath = Join-Path $OutputDirectory "WuwaMatrixPlanner-v$version-win-x64.zip"
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
[IO.Compression.ZipFile]::CreateFromDirectory($releaseRoot, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $true)
$zipHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$zipHash  $([IO.Path]::GetFileName($zipPath))" | Set-Content -LiteralPath (Join-Path $OutputDirectory 'SHA256SUMS.txt') -Encoding ASCII
Write-Output "Built: $zipPath"
Write-Output "Files: $($hashes.Count); SHA256: $zipHash"
