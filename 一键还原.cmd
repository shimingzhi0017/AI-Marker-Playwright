@echo off
chcp 65001 >nul
if not exist "%~dp0reset.ps1" goto unpack
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0reset.ps1"
pause
exit /b
:unpack
echo Please extract ALL project files first.
pause
