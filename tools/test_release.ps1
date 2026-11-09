param([string]$ReleaseDirectory)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$package = Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $package.version
$parsedVersion = [version]$version
$displayVersion = if ($parsedVersion.Build -gt 0) { "V$version" } else { "V$($parsedVersion.Major).$($parsedVersion.Minor)" }
if (-not $ReleaseDirectory) { $ReleaseDirectory = Join-Path $projectRoot "dist\WuwaMatrixPlanner-v$version-win-x64" }
$ReleaseDirectory = [IO.Path]::GetFullPath($ReleaseDirectory)
$manifest = Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$releasePackage = Get-Content -LiteralPath (Join-Path $ReleaseDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.version -ne $version -or $releasePackage.version -ne $version) { throw 'Packaged version mismatch.' }
if ($manifest.fileCount -ne @($manifest.files).Count) { throw 'Manifest file count mismatch.' }
$manifestPaths = @{}
foreach ($entry in $manifest.files) {
    $file = Join-Path $ReleaseDirectory $entry.path
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing file: $($entry.path)" }
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($hash -ne $entry.sha256) { throw "Hash mismatch: $($entry.path)" }
    if ((Get-Item -LiteralPath $file).Length -ne $entry.bytes) { throw "Size mismatch: $($entry.path)" }
    $manifestPaths[$entry.path] = $true
}
$launcher = Join-Path $ReleaseDirectory '终焉矩阵血线排布.exe'
$launcherVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($launcher).FileVersion
if ($launcherVersion -ne "$version.0") { throw "Launcher version mismatch: $launcherVersion" }
$sourceNode = Join-Path $ReleaseDirectory 'runtime\node.exe'
if ((& $sourceNode --version) -ne $manifest.nodeVersion) { throw 'Bundled Node.js version mismatch.' }
$originalPath = $env:PATH
$originalMatrixUrl = $env:MATRIX_URL
$env:PATH = "$env:SystemRoot\System32"
$process = $null
$serverProcessId = $null
try {
    $process = Start-Process -FilePath $launcher -ArgumentList @('--headless','--port','4186') -WindowStyle Hidden -PassThru
    $health = $null
    for ($attempt = 0; $attempt -lt 50; $attempt++) {
        Start-Sleep -Milliseconds 150
        for ($port = 4186; $port -lt 4196; $port++) {
            try {
                $candidate = Invoke-RestMethod -Uri "http://127.0.0.1:$port/__matrix_health" -TimeoutSec 1
                if ($candidate.root -eq $ReleaseDirectory -and $candidate.app -eq 'wuwa-matrix-hp-planner') { $health = $candidate; $testPort = $port; break }
            } catch { }
        }
        if ($health) { break }
        if ($process.HasExited) { throw "Launcher exited: $($process.ExitCode)" }
    }
    if (-not $health) { throw 'Packaged service did not start.' }
    if ($health.version -ne $version) { throw 'Packaged API version mismatch.' }
    $serverProcessId = [int]$health.pid
    $baseUrl = "http://127.0.0.1:$testPort"
    $html = (Invoke-WebRequest -Uri $baseUrl -UseBasicParsing).Content
    $expectedTitle = "<title>终焉矩阵血线排布 $displayVersion</title>"
    $expectedBadge = "<span class=`"brand-sub`">血线排布 / $displayVersion</span>"
    if (-not $html.Contains($expectedTitle) -or -not $html.Contains($expectedBadge)) { throw 'Packaged title or version badge does not exactly match the release version.' }
    $scores = Invoke-RestMethod -Uri "$baseUrl/data/scores.json"
    if ($scores.records.Count -ne 75 -or $scores.max_round -ne 15) { throw 'Score data mismatch.' }
    $registry = Invoke-RestMethod -Uri "$baseUrl/config/seasons.json"
    if (@($registry.seasons).Count -ne 2) { throw 'Season registry mismatch.' }
    $assetPaths = @()
    foreach ($definition in $registry.seasons) {
        $season = Invoke-RestMethod -Uri "$baseUrl/$($definition.file)"
        if ($season.id -ne $definition.id -or $season.maxRound -ne 15 -or @($season.scoring.waves).Count -ne 75) { throw "Season data mismatch: $($definition.id)" }
        $expected = Get-Content -LiteralPath (Join-Path $projectRoot $definition.file) -Raw -Encoding UTF8 | ConvertFrom-Json
        if (($season | ConvertTo-Json -Depth 50 -Compress) -ne ($expected | ConvertTo-Json -Depth 50 -Compress)) { throw "Packaged season config differs from source: $($definition.id)" }
        $assetPaths += @($season.bosses) + @($season.circuits) + @($season.characters) | ForEach-Object { $_.icon_file }
    }
    $elements = Invoke-RestMethod -Uri "$baseUrl/data/elements.json"
    $assetPaths += @($elements.entries) | ForEach-Object { $_.icon_file }
    foreach ($asset in ($assetPaths | Sort-Object -Unique)) {
        if (-not $manifestPaths.ContainsKey($asset)) { throw "Configured asset missing from manifest: $asset" }
        if ((Invoke-WebRequest -Uri "$baseUrl/$asset" -Method Head -UseBasicParsing).StatusCode -ne 200) { throw "Configured asset not served: $asset" }
    }
    $second = Start-Process -FilePath $launcher -ArgumentList @('--headless','--port','4186') -WindowStyle Hidden -PassThru
    if (-not $second.WaitForExit(8000) -or $second.ExitCode -ne 0) { throw 'Second launch did not reuse existing service.' }
    $after = Invoke-RestMethod -Uri "$baseUrl/__matrix_health"
    if ($after.pid -ne $serverProcessId) { throw 'Server reuse changed the process.' }
    $env:MATRIX_URL = $baseUrl
    Push-Location $projectRoot
    try {
        foreach ($script in @('tools/browser_smoke.mjs','tools/matrix_plans_smoke.mjs','tools/boss_details_smoke.mjs','tools/boss_properties_smoke.mjs','tools/pending_delete_smoke.mjs','tools/picker_overview_smoke.mjs','tools/score_table_migration_smoke.mjs','tools/features_1_2_smoke.mjs','tools/picker_animation_smoke.mjs','tools/drag_preview_smoke.mjs','tools/pinyin_search_smoke.mjs','tools/rover_merge_smoke.mjs','tools/picker_order_sidebar_smoke.mjs')) {
            & $sourceNode $script
            if ($LASTEXITCODE -ne 0) { throw "Packaged browser checks failed: $script" }
        }
    } finally { Pop-Location }
    Write-Output "PASS: $($manifest.fileCount) file hashes and sizes; no PATH Node.js; packaged EXE; $displayVersion API and UI; bundled R15 season configs and assets; second launch reuse; full browser, multi-plan, Boss-detail, enlarged picker and team-overview workflows."
} finally {
    if ($serverProcessId) {
        try {
            $check = Invoke-RestMethod -Uri "http://127.0.0.1:$testPort/__matrix_health" -TimeoutSec 1
            if ($check.root -eq $ReleaseDirectory -and [int]$check.pid -eq $serverProcessId) { Stop-Process -Id $serverProcessId -Force -ErrorAction SilentlyContinue }
        } catch { }
    }
    if ($process -and -not $process.HasExited) { Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue }
    $env:PATH = $originalPath
    if ($null -eq $originalMatrixUrl) { Remove-Item Env:MATRIX_URL -ErrorAction SilentlyContinue }
    else { $env:MATRIX_URL = $originalMatrixUrl }
}
