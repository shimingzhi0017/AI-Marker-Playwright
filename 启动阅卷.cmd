@echo off
chcp 65001 >nul
if not exist "%~dp0launcher.ps1" goto unpack
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0launcher.ps1" -Action run
pause
exit /b
:unpack
echo Please extract ALL files from the ZIP first. Do not run inside the ZIP.
echo Open the extracted folder, then run this file again.
pause
