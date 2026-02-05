#!/bin/bash

# AccessFlow Stop Script
# Stops all running backend services

echo "🛑 Stopping AccessFlow backends..."

# Stop main backend (which will also stop finger tracker subprocess)
if [ -f /tmp/accessflow-main.pid ]; then
    MAIN_PID=$(cat /tmp/accessflow-main.pid)
    if kill -0 $MAIN_PID 2>/dev/null; then
        kill $MAIN_PID
        echo "✅ Stopped main backend (PID: $MAIN_PID)"
    else
        echo "⚠️  Main backend not running"
    fi
    rm /tmp/accessflow-main.pid
fi

# Clean up any orphaned finger tracker processes
pkill -f "python3 finger_tracker.py"

echo ""
echo "✅ All AccessFlow backends stopped"
