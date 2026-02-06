#!/bin/bash

# AccessFlow Startup Script
# Starts all backend services needed for the extension

echo "🚀 Starting AccessFlow backends..."

# Navigate to backend directory
cd "$(dirname "$0")/accessflow-backend"

# Check if .env file exists
if [ ! -f .env ]; then
    echo "⚠️  Warning: .env file not found. Please create one with your OPENAI_API_KEY"
fi

# Start main backend (GPT features, voice, AND finger tracker management)
echo "Starting main backend on http://localhost:8000..."
python main.py > /tmp/accessflow-main.log 2>&1 &
MAIN_PID=$!

# Save PID for later shutdown
echo $MAIN_PID > /tmp/accessflow-main.pid

# Wait for backend to initialize
sleep 2

echo ""
echo "✅ AccessFlow backend started!"
echo ""
echo "📊 Status:"
echo "   Main backend: http://localhost:8000 (PID: $MAIN_PID)"
echo "   Finger tracker: On-demand (starts when you click the button)"
echo ""
echo "📝 Logs:"
echo "   Main: /tmp/accessflow-main.log"
echo ""
echo "🎯 Next steps:"
echo "   1. Open Chrome and load the AccessFlow extension"
echo "   2. Click the extension icon to open the sidepanel"
echo "   3. Start using AccessFlow features!"
echo ""
echo "To stop all backends, run: ./stop-accessflow.sh"
