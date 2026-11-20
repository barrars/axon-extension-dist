@echo off
rem Double-clickable Windows installer for the Evidence.com Data Aggregator
rem extension. Calls install-extension.ps1 from the public build repo.
setlocal
echo Installing Evidence.com Data Aggregator...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/barrars/axon-extension-dist/main/install-extension.ps1 | iex"
echo.
pause
