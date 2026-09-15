@echo off
title Kolondiro POS - Auto Open Setup
echo ============================================
echo   Kolondiro - Auto Open on Boot
echo ============================================
echo.
echo This will make kolondiro.vercel.app open automatically
echo in Chrome every time this computer starts.
echo.

REM Create startup shortcut for Chrome opening kolondiro.vercel.app in kiosk mode
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\bp.vbs"
echo sLinkFile = oWS.SpecialFolders("Startup") ^& "\KolondiroPOS.lnk" >> "%TEMP%\bp.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\bp.vbs"

REM Try to find Chrome
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    echo oLink.TargetPath = "C:\Program Files\Google\Chrome\Application\chrome.exe" >> "%TEMP%\bp.vbs"
) else if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    echo oLink.TargetPath = "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" >> "%TEMP%\bp.vbs"
) else (
    echo oLink.TargetPath = "chrome.exe" >> "%TEMP%\bp.vbs"
)

echo oLink.Arguments = "--start-fullscreen https://kolondiro.vercel.app" >> "%TEMP%\bp.vbs"
echo oLink.WindowStyle = 1 >> "%TEMP%\bp.vbs"
echo oLink.Save >> "%TEMP%\bp.vbs"
cscript //nologo "%TEMP%\bp.vbs"
del "%TEMP%\bp.vbs"

echo.
echo [OK] Auto-open shortcut created!
echo.
echo When this computer starts, Chrome will automatically
echo open kolondiro.vercel.app in full screen.
echo.
echo To remove: delete "KolondiroPOS" from your Startup folder.
echo (Press Win+R, type "shell:startup", press Enter)
echo.
pause
