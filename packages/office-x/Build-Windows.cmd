@echo off
powershell.exe -NoProfile -File "%~dp0scripts\Build-Windows.ps1" %*
if errorlevel 1 exit /b 1
pause
