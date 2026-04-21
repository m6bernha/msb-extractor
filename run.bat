@echo off
REM ===================================================================
REM  MSB Extractor - one-click parse helper for Windows.
REM
REM  Double-click this file. It will:
REM    1. Verify Python is installed.
REM    2. Create a local virtual environment (.venv) if missing.
REM    3. Install msb-extractor if not already installed.
REM    4. Parse captures\msb_capture.json -> captures\training_log.xlsx.
REM    5. Offer to open the spreadsheet.
REM
REM  You still need to run the browser scraper first (see scraper\README.md)
REM  and move the downloaded msb_capture.json into the captures\ folder.
REM ===================================================================

setlocal ENABLEDELAYEDEXPANSION
cd /d "%~dp0"

echo.
echo === MSB Extractor - one-click parse ===
echo.

REM --- 1. Python present? ----------------------------------------------
where python >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not on your PATH.
    echo.
    echo Install Python 3.11 or newer from https://www.python.org/downloads/
    echo During install, tick the box that says "Add Python to PATH".
    echo Then close and reopen this window and try again.
    echo.
    pause
    exit /b 1
)

REM --- 2. venv present? -----------------------------------------------
if not exist ".venv\Scripts\python.exe" (
    echo Creating Python virtual environment in .venv\ ^(one-time setup^)...
    python -m venv .venv
    if errorlevel 1 (
        echo ERROR: Failed to create virtual environment.
        echo Check that you have write access to this folder.
        pause
        exit /b 1
    )
)

REM --- 3. package installed? ------------------------------------------
".venv\Scripts\python.exe" -c "import msb_extractor" >nul 2>&1
if errorlevel 1 (
    echo Installing msb-extractor ^(first run, 30-60s^)...
    ".venv\Scripts\python.exe" -m pip install --quiet --upgrade pip
    ".venv\Scripts\python.exe" -m pip install --quiet -e .
    if errorlevel 1 (
        echo ERROR: Install failed. See the output above for details.
        pause
        exit /b 1
    )
)

REM --- 4. capture file present? ---------------------------------------
if not exist "captures\msb_capture.json" (
    echo.
    echo ERROR: No capture found at captures\msb_capture.json
    echo.
    echo Before running this script:
    echo   1. Open app.mystrengthbook.com in your browser ^(logged in^).
    echo   2. Paste scraper\msb-scraper.js into DevTools console ^(F12^).
    echo   3. Click any day on the MSB calendar within 15 seconds.
    echo   4. Move the downloaded msb_capture.json to the captures\ folder.
    echo   5. Double-click this file again.
    echo.
    pause
    exit /b 1
)

REM --- 5. parse --------------------------------------------------------
echo.
echo Parsing captures\msb_capture.json ...
".venv\Scripts\python.exe" -m msb_extractor parse "captures\msb_capture.json" -o "captures\training_log.xlsx"
if errorlevel 1 (
    echo.
    echo ERROR: Parse failed. See output above.
    pause
    exit /b 1
)

REM --- 6. offer to open -----------------------------------------------
echo.
echo Done. Output saved to: captures\training_log.xlsx
echo.
set /p OPEN="Open the spreadsheet now? (y/n): "
if /i "!OPEN!"=="y" (
    start "" "captures\training_log.xlsx"
)

endlocal
