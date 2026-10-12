@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "PLAYWRIGHT_BROWSERS_PATH=%~dp0browsers"
set "AI_MARKER_DATA_ROOT=%LOCALAPPDATA%\AI-Marker-Playwright\user-data"
if not exist "%~dp0runtime\node.exe" (
  echo 请先将压缩包全部解压，再启动软件。
  pause
  exit /b 1
)
"%~dp0runtime\node.exe" "%~dp0src\server.mjs"
if errorlevel 1 (
  echo 程序未能正常启动，请保留上方错误信息。
  pause
)
endlocal
