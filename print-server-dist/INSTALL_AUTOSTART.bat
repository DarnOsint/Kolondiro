@echo off
title Installing Kolondiro Print Server
echo Copying files to C:\KolondiroPrint...
mkdir "C:\KolondiroPrint" 2>nul
copy "%~dp0KolondiroPrint.exe" "C:\KolondiroPrint\KolondiroPrint.exe" /Y
copy "%~dp0START_PRINT_SERVER.bat" "C:\KolondiroPrint\START_PRINT_SERVER.bat" /Y
echo Creating auto-start shortcut...
echo Set oWS = WScript.CreateObject("WScript.Shell") > "%TEMP%\s.vbs"
echo sLinkFile = oWS.SpecialFolders("Startup") ^& "\KolondiroPrint.lnk" >> "%TEMP%\s.vbs"
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> "%TEMP%\s.vbs"
echo oLink.TargetPath = "C:\KolondiroPrint\KolondiroPrint.exe" >> "%TEMP%\s.vbs"
echo oLink.WindowStyle = 7 >> "%TEMP%\s.vbs"
echo oLink.Save >> "%TEMP%\s.vbs"
cscript "%TEMP%\s.vbs"
echo.
echo Done! Starting print server now...
start "" "C:\KolondiroPrint\KolondiroPrint.exe"
echo.
echo Test it: open Chrome and go to http://localhost:6543/health
pause
