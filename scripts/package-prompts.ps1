$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot 'export-prompts.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Prompt export failed' }
$exportDir = (Resolve-Path (Join-Path $PSScriptRoot '../docs/prompt-exports')).Path
# Read labels from UTF-8 JSON so Windows PowerShell does not depend on the
# script source encoding for Chinese archive entry names.
$entries = Get-Content -LiteralPath (Join-Path $exportDir 'all-prompts.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$labels = @($entries | Select-Object -ExpandProperty subjectLabel -Unique)
if ($labels.Count -ne 9) { throw 'Expected nine subjects' }
$files = @($labels | ForEach-Object { Join-Path $exportDir ($_ + '.md') })
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing subject Markdown: $file" }
}
$archiveName = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5Lmd5a2m56eR5o+Q56S66K+NLeaMieWtpuenkeaLhuWIhi56aXA='))
$archivePath = Join-Path $exportDir $archiveName
Compress-Archive -LiteralPath $files -DestinationPath $archivePath -Force
Write-Output $archivePath
