param([ValidateSet('ui','run','diagnose','install','check')][string]$Action = 'ui')
$ErrorActionPreference = 'Stop'
try {
    Set-Location -LiteralPath $PSScriptRoot
    foreach ($required in @('src/cli.mjs', 'src/browser.mjs', 'package.json', 'package-lock.json', 'config.example.json')) {
        if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot $required))) {
            throw '项目文件不完整。请先将 ZIP 全部解压到普通文件夹，再运行启动文件。'
        }
    }
    # Explorer may still have the PATH from before Node.js was installed.
    $env:Path = [Environment]::GetEnvironmentVariable('Path', 'User') + ';' + [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + $env:Path
    if (!(Get-Command node.exe -ErrorAction SilentlyContinue) -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        $nodeParent = Join-Path $env:LOCALAPPDATA 'Programs'
        $portable = Get-ChildItem -LiteralPath $nodeParent -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
            Where-Object { (Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe')) -and (Test-Path -LiteralPath (Join-Path $_.FullName 'npm.cmd')) } |
            Sort-Object { [version]($_.Name -replace '^node-v', '' -replace '-win-x64$', '') } -Descending |
            Select-Object -First 1
        if ($portable) { $env:Path = $portable.FullName + ';' + $env:Path }
    }
    if (!(Get-Command node.exe -ErrorAction SilentlyContinue) -or !(Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw '未找到 Node.js 和 npm。请打开 https://nodejs.org/ 下载并安装 Node.js 24 或更新的 LTS 版本，保留 npm 和 Add to PATH 选项。安装后关闭本窗口，重新双击启动可视化.cmd。详见首次运行说明.md。'
    }
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.') { throw '无法读取 Node.js 版本，请重新安装官方 Node.js LTS。' }
    if ([int]$Matches[1] -lt 24) { throw "当前 Node.js 为 $nodeVersion，本项目需要 24 或更新版本。请从 https://nodejs.org/ 安装符合要求的 LTS 版本，再重新运行。" }
    Write-Host "Node.js $nodeVersion；正在检查运行环境……"
    & node.exe --input-type=module -e "import 'playwright'; import 'sharp';"
    $dependenciesReady = $LASTEXITCODE -eq 0
    if ($Action -eq 'install' -or !$dependenciesReady) {
        Write-Host '正在安装项目依赖。首次运行需要联网，请等待完成……'
        & npm.cmd ci
        if ($LASTEXITCODE -ne 0) { throw '依赖安装失败。请检查网络和 npm 下载错误，然后重新运行安装依赖.cmd。' }
    }
    # Browser caches may be missing or broken even when node_modules exists.
    $browserResult = & node.exe (Join-Path $PSScriptRoot 'src/browser.mjs')
    $browserReady = $LASTEXITCODE -eq 0
    if (!$browserReady) {
        if ($env:AI_MARKER_BROWSER_CHANNEL -and $env:AI_MARKER_BROWSER_CHANNEL -ne 'chromium') {
            throw "指定的浏览器 $env:AI_MARKER_BROWSER_CHANNEL 不可用。请安装该浏览器，或清除 AI_MARKER_BROWSER_CHANNEL 后重新运行。"
        }
        Write-Host '正在安装专用 Chromium 浏览器。首次下载可能需要几分钟……'
        & npx.cmd playwright install chromium
        if ($LASTEXITCODE -ne 0) { throw '浏览器下载失败。请检查网络后重新运行安装依赖.cmd；Windows 也可安装 Microsoft Edge 后重试。' }
        $browserResult = & node.exe (Join-Path $PSScriptRoot 'src/browser.mjs')
        if ($LASTEXITCODE -ne 0) { throw '浏览器仍无法启动。请查看上面的具体错误；Windows 可安装或更新 Microsoft Edge 后重试，详见首次运行说明.md。' }
    }
    $env:AI_MARKER_BROWSER_CHANNEL = ($browserResult | Select-Object -Last 1).Trim()
    Write-Host "浏览器检查通过：$env:AI_MARKER_BROWSER_CHANNEL（使用项目专用登录目录）。"
    if ($Action -eq 'check') {
        & node.exe (Join-Path $PSScriptRoot 'src/cli.mjs') help
        if ($LASTEXITCODE -ne 0) { throw '项目启动检查失败，请查看上面的错误。' }
        exit 0
    }
    if ($Action -eq 'install') { Write-Host '运行环境已就绪。请双击启动可视化.cmd。'; exit 0 }
    if (!(Test-Path -LiteralPath (Join-Path $PSScriptRoot 'config.json'))) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'config.example.json') -Destination (Join-Path $PSScriptRoot 'config.json')
        Write-Host '已创建 config.json。请在工作台导入配置或设置方案和模型接口。'
    }
    if ($Action -eq 'ui') {
        & node.exe (Join-Path $PSScriptRoot 'src/server.mjs')
    } else {
        & node.exe (Join-Path $PSScriptRoot 'src/cli.mjs') $Action (Join-Path $PSScriptRoot 'config.json')
    }
    if ($LASTEXITCODE -ne 0) { throw '程序发生错误，请查看上面的具体信息。' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
