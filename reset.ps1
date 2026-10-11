$ErrorActionPreference = 'Stop'
try {
    $resetRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
    $resetScript = Join-Path $resetRoot 'src/factory-reset.mjs'
    if (!(Test-Path -LiteralPath $resetScript) -or !(Test-Path -LiteralPath (Join-Path $resetRoot 'config.example.json'))) { throw '项目文件不完整，请先全部解压。' }
    function Assert-ProjectClosed {
        $active = Get-CimInstance Win32_Process | Where-Object {
            $_.ProcessId -ne $PID -and $_.Name -match '^(node|chrome|msedge)\.exe$' -and $_.CommandLine -and
            (($_.CommandLine.IndexOf($resetRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0) -or ($env:AI_MARKER_DATA_ROOT -and $_.CommandLine.IndexOf((Split-Path -Parent $env:AI_MARKER_DATA_ROOT), [StringComparison]::OrdinalIgnoreCase) -ge 0))
        }
        if ($active) { throw '本软件或专用浏览器仍在运行。请先关闭控制台、阅卷浏览器和本目录启动的程序，再双击一键还原.cmd。' }
    }
    Assert-ProjectClosed
    Write-Host '===== 还原整个软件 ====='
    Write-Host '保留：智学网及其他网站内置适配、网址匹配、元素和答卷识别、填分及提交逻辑。'
    Write-Host '保留：AI接入方式、主流供应商模板、默认配置和全部已完成功能。'
    Write-Host '清空：个人任务、题目说明、参考答案、评分标准、历史记录和答卷图片。'
    Write-Host '清空：个人API密钥、登录信息、浏览器缓存和个人设置中的本机路径。'
    Write-Host '恢复默认：双评、仲裁、倒计时、份数；默认人工确认、双评关闭、份数无限制。'
    Write-Host '个人资料将先移入本机 backups 备份；其中含密钥和登录资料，不要上传或随软件分发。'
    Write-Host '软件目录之外的导出文件不会删除。'
    $resetAnswer = Read-Host '确认执行请输入“还原”；直接按回车取消'
    if ($resetAnswer -ne '还原') { Write-Host '已取消，资料未修改。'; exit 0 }
    Assert-ProjectClosed
    $env:Path = [Environment]::GetEnvironmentVariable('Path','User') + ';' + [Environment]::GetEnvironmentVariable('Path','Machine') + ';' + $env:Path
    $resetNode = Get-Command node.exe -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath (Join-Path $resetRoot 'runtime/node.exe')) { $resetNode = Get-Item -LiteralPath (Join-Path $resetRoot 'runtime/node.exe') }
    if (!$resetNode) {
        $resetPortable = Get-ChildItem -LiteralPath (Join-Path $env:LOCALAPPDATA 'Programs') -Directory -Filter 'node-v*-win-x64' -ErrorAction SilentlyContinue |
            Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'node.exe') } |
            Sort-Object { [version]($_.Name -replace '^node-v','' -replace '-win-x64$','') } -Descending | Select-Object -First 1
        if ($resetPortable) { $resetNode = Get-Item -LiteralPath (Join-Path $resetPortable.FullName 'node.exe') }
    }
    if (!$resetNode) { throw '未找到Node.js，请安装项目所需的Node.js后重试。资料未修改。' }
    $resetNodePath = if ($resetNode.Source) { $resetNode.Source } else { $resetNode.FullName }
    & $resetNodePath $resetScript --confirmed
    if ($LASTEXITCODE -ne 0) { throw '还原未完成，请查看上面的错误及本机 backups 目录。' }
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
