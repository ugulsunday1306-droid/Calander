@echo off
chcp 65001 > nul
title UGUL Calander Standalone Updater

echo ===================================================
echo     UGUL Calander Standalone Helper Updater
echo ===================================================
echo.

set DOWNLOAD_URL=%~1
set APP_DIR=%~dp0
set EXE_PATH=%APP_DIR%UGULCalander.exe
set TEMP_ZIP=%TEMP%\ugul_standalone_update.zip
set EXTRACT_DIR=%TEMP%\ugul_standalone_extracted

echo [1/5] Waiting for UGULCalander.exe to terminate...
timeout /t 2 /nobreak > nul
taskkill /F /IM UGULCalander.exe > nul 2>&1
timeout /t 1 /nobreak > nul
echo -> App terminated safely.
echo.

echo [2/5] Downloading latest update patch...
echo -> URL: %DOWNLOAD_URL%
powershell -Command "[System.Net.ServicePointManager]::SecurityProtocol = [System.Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('%DOWNLOAD_URL%', '%TEMP_ZIP%')"
if not exist "%TEMP_ZIP%" (
    echo [ERROR] Download Failed! Please check your network connection.
    goto END
)
echo -> Patch downloaded successfully.
echo.

echo [3/5] Unzipping patch package...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
mkdir "%EXTRACT_DIR%"
powershell -Command "Expand-Archive -LiteralPath '%TEMP_ZIP%' -DestinationPath '%EXTRACT_DIR%' -Force"
echo -> Unzip completed.
echo.

echo [4/5] Overwriting application files...
set SOURCE_DIR=%EXTRACT_DIR%
if exist "%EXTRACT_DIR%\UGULCalander-win32-x64" (
    set SOURCE_DIR=%EXTRACT_DIR%\UGULCalander-win32-x64
)

xcopy /s /e /y /i "%SOURCE_DIR%\*" "%APP_DIR%" > nul
echo -> File overwrite completed!
echo.

echo [5/5] Cleaning temp files and restarting app...
if exist "%EXTRACT_DIR%" rmdir /s /q "%EXTRACT_DIR%"
if exist "%TEMP_ZIP%" del /f /q "%TEMP_ZIP%"

if exist "%EXE_PATH%" (
    echo -> Launching: %EXE_PATH%
    start "" /D "%APP_DIR%" "%EXE_PATH%"
) else (
    echo -> Launching main app...
    start "" /D "%APP_DIR%" "UGULCalander.exe"
)

echo.
echo ===================================================
echo     Update Complete! Restarting application...
echo ===================================================
timeout /t 2 /nobreak > nul
exit

:END
echo.
echo Press any key to exit updater...
pause > nul
exit
