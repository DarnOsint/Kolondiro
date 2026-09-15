@echo off
title Kolondiro Print Server - Background Service Install
echo ============================================
echo   Kolondiro - Print Server Installer
echo ============================================
echo.
echo Installing print server as background service...
echo.

mkdir "C:\KolondiroPrint" 2>nul
copy "%~dp0KolondiroPrint.exe" "C:\KolondiroPrint\KolondiroPrint.exe" /Y >nul

echo [1/3] Files copied to C:\KolondiroPrint
echo.

REM Remove old scheduled task if exists
schtasks /delete /tn "KolondiroPrintServer" /f >nul 2>&1

REM Create scheduled task that runs at system startup (before login)
schtasks /create /tn "KolondiroPrintServer" /tr "C:\KolondiroPrint\KolondiroPrint.exe" /sc onstart /ru SYSTEM /rl highest /f >nul 2>&1

echo [2/3] Auto-start service created (runs on boot, no window)
echo.

REM Also create logon task as backup
schtasks /create /tn "KolondiroPrintServerLogon" /tr "C:\KolondiroPrint\KolondiroPrint.exe" /sc onlogon /rl highest /f >nul 2>&1

REM Start it now
taskkill /f /im KolondiroPrint.exe >nul 2>&1
start "" /min "C:\KolondiroPrint\KolondiroPrint.exe"

echo [3/3] Print server started!
echo.
echo ============================================
echo   DONE! The print server will now:
echo   - Run silently in the background
echo   - Auto-start when Windows boots
echo   - Listen on port 6543
echo   - Forward prints to 192.168.0.10
echo.
echo   Test: open Chrome and go to
echo   http://localhost:6543/health
echo ============================================
echo.
pause
