@echo off
REM AccessFlow Startup Script for Windows
REM Starts all backend services needed for the extension

echo Starting AccessFlow backends...
echo.

cd /d "%~dp0accessflow-backend"

REM Check if .env file exists
if not exist .env (
    echo Warning: .env file not found. Please create one with your OPENAI_API_KEY
)

REM Start main backend (GPT features, voice, AND finger tracker management)
echo Starting main backend on http://localhost:8000...
start /B python main.py > "%TEMP%\accessflow-main.log" 2>&1

REM Wait for backend to initialize
timeout /t 2 /nobreak > nul

echo.
echo AccessFlow backend started!
echo.
echo Status:
echo    Main backend: http://localhost:8000
echo    Finger tracker: On-demand (starts when you click the button)
echo.
echo Logs:
echo    Main: %TEMP%\accessflow-main.log
echo.
echo Next steps:
echo    1. Open Chrome and load the AccessFlow extension
echo    2. Click the extension icon to open the sidepanel
echo    3. Start using AccessFlow features!
echo.
echo To stop all backends, run: stop-accessflow.bat
