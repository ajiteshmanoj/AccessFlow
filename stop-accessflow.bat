@echo off
REM AccessFlow Stop Script for Windows
REM Stops all running backend services

echo Stopping AccessFlow backends...

REM Stop main backend
taskkill /F /IM python.exe /FI "WINDOWTITLE eq main.py*" 2>nul
if %ERRORLEVEL% EQU 0 (
    echo Stopped main backend
) else (
    echo Main backend not running
)

REM Clean up any orphaned finger tracker processes
taskkill /F /IM python.exe /FI "WINDOWTITLE eq finger_tracker.py*" 2>nul

echo.
echo All AccessFlow backends stopped
