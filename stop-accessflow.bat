@echo off
REM AccessFlow Stop Script for Windows
REM Stops all running backend services and frees ports

echo Stopping AccessFlow backends...

REM Kill processes using port 8000 (main backend)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":8000" ^| find "LISTENING"') do (
    echo Killing process on port 8000 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)

REM Kill processes using port 9000 (finger tracker WebSocket)
for /f "tokens=5" %%a in ('netstat -aon ^| find ":9000" ^| find "LISTENING"') do (
    echo Killing process on port 9000 (PID: %%a)
    taskkill /F /PID %%a 2>nul
)

REM Also kill any python processes running our scripts (backup method)
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *main.py*" 2>nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq *finger_tracker.py*" 2>nul

REM Wait a moment for ports to be released
timeout /t 2 /nobreak >nul

echo.
echo All AccessFlow backends stopped and ports freed
