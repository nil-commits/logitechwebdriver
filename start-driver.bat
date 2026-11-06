@echo off
title Logitech G HUB Local Web Driver (Zero-Internet / Zero-Bloat)
cd /d "%~dp0"

echo [LGHUB Local Web Driver] Stopping Electron UI / System Tray / SSO bloat processes...
taskkill /F /IM lghub.exe >nul 2>&1
taskkill /F /IM lghub_system_tray.exe >nul 2>&1
taskkill /F /IM lghub_sso_handler.exe >nul 2>&1

echo [LGHUB Local Web Driver] Starting local hardware bridge on http://127.0.0.1:1133 ...
start "" "http://127.0.0.1:1133"
node "%~dp0server.js"
pause
