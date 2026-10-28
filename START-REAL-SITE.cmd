@echo off
setlocal
title UTS Housing - Real Local Site
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-LocalSite.ps1"
if errorlevel 1 (
  echo.
  echo Startup did not finish. Read the error above before closing this window.
)
echo.
pause
