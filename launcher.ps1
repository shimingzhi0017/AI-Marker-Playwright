param([ValidateSet('ui','run','diagnose','install','check')][string]$Action = 'ui')
$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath $PSScriptRoot
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'src/cli.mjs')) -or !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'package.json'))) {
        throw 'Incomplete project. Extract ALL files from the ZIP first.'
    }
    if (!(Get-Command node.exe -ErrorAction SilentlyContinue) -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw 'Node.js is required. Install Node.js LTS, then run again.'
    }
    if ($Action -eq 'check') {
        & node.exe (Join-Path $PSScriptRoot 'src/cli.mjs') help
        if ($LASTEXITCODE -ne 0) { throw 'Project startup check failed.' }
        exit 0
    }
    if ($Action -eq 'install' -or !(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'node_modules/playwright/package.json'))) {
        Write-Host 'Installing project dependencies...'
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your network and retry.' }
        & npx.cmd playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw 'Browser installation failed. Check your network and retry.' }
    }
    if ($Action -eq 'install') { Write-Host 'Installation completed.'; exit 0 }
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'config.json'))) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config.example.json') -Destination (Join-Path $PSScriptRoot 'config.json')
        Write-Host 'Created config.json. Configure or import your settings before grading.'
    }
    if ($Action -eq 'ui') {
        & node.exe (Join-Path $PSScriptRoot 'src/server.mjs')
    } else {
        & node.exe (Join-Path $PSScriptRoot 'src/cli.mjs') $Action (Join-Path $PSScriptRoot 'config.json')
    }
    if ($LASTEXITCODE -ne 0) { throw 'Program stopped with an error. See the message above.' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
