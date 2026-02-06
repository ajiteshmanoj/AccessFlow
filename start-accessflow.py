#!/usr/bin/env python3
"""
AccessFlow Universal Startup Script
Automatically detects OS and starts backend services
Works on Windows, macOS, and Linux
"""

import os
import sys
import subprocess
import platform
import time
from pathlib import Path

def main():
    print("🚀 Starting AccessFlow backends...\n")

    # Detect OS
    os_type = platform.system()
    print(f"Detected OS: {os_type}")

    # Navigate to backend directory
    script_dir = Path(__file__).parent
    backend_dir = script_dir / "accessflow-backend"

    if not backend_dir.exists():
        print(f"❌ Error: Backend directory not found at {backend_dir}")
        sys.exit(1)

    # Check if .env file exists
    env_file = backend_dir / ".env"
    if not env_file.exists():
        print("⚠️  Warning: .env file not found. Please create one with your OPENAI_API_KEY\n")

    # Determine log file location based on OS
    if os_type == "Windows":
        log_dir = Path(os.environ.get("TEMP", "C:\\Temp"))
        pid_dir = log_dir
    else:  # macOS, Linux
        log_dir = Path("/tmp")
        pid_dir = log_dir

    log_file = log_dir / "accessflow-main.log"
    pid_file = pid_dir / "accessflow-main.pid"

    # Start main backend
    print("Starting main backend on http://localhost:8000...")

    try:
        # Open log file for writing
        with open(log_file, "w") as log:
            # Start the process
            if os_type == "Windows":
                # Windows: use CREATE_NEW_PROCESS_GROUP to allow it to run independently
                process = subprocess.Popen(
                    [sys.executable, "main.py"],
                    cwd=backend_dir,
                    stdout=log,
                    stderr=subprocess.STDOUT,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os_type == "Windows" else 0
                )
            else:
                # Unix: standard background process
                process = subprocess.Popen(
                    [sys.executable, "main.py"],
                    cwd=backend_dir,
                    stdout=log,
                    stderr=subprocess.STDOUT
                )

        # Save PID for later shutdown
        with open(pid_file, "w") as f:
            f.write(str(process.pid))

        # Wait for backend to initialize
        print("Waiting for backend to start...")
        time.sleep(3)

        # Check if process is still running
        if process.poll() is not None:
            print("\n❌ Backend failed to start. Check logs for details:")
            print(f"   {log_file}\n")
            sys.exit(1)

        print("\n✅ AccessFlow backend started!\n")
        print("📊 Status:")
        print(f"   Main backend: http://localhost:8000 (PID: {process.pid})")
        print("   Finger tracker: On-demand (starts when you click the button)\n")
        print("📝 Logs:")
        print(f"   Main: {log_file}\n")
        print("🎯 Next steps:")
        print("   1. Open Chrome and load the AccessFlow extension")
        print("   2. Click the extension icon to open the sidepanel")
        print("   3. Start using AccessFlow features!\n")

        if os_type == "Windows":
            print("To stop all backends, run: python stop-accessflow.py")
        else:
            print("To stop all backends, run: python stop-accessflow.py or ./stop-accessflow.sh")

    except Exception as e:
        print(f"\n❌ Error starting backend: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
