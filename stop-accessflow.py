#!/usr/bin/env python3
"""
AccessFlow Universal Stop Script
Automatically detects OS and stops backend services
Works on Windows, macOS, and Linux
"""

import os
import sys
import signal
import platform
import subprocess
from pathlib import Path

def main():
    print("🛑 Stopping AccessFlow backends...\n")

    # Detect OS
    os_type = platform.system()

    # Determine PID file location based on OS
    if os_type == "Windows":
        pid_dir = Path(os.environ.get("TEMP", "C:\\Temp"))
    else:  # macOS, Linux
        pid_dir = Path("/tmp")

    pid_file = pid_dir / "accessflow-main.pid"

    # Stop main backend
    if pid_file.exists():
        try:
            with open(pid_file, "r") as f:
                pid = int(f.read().strip())

            # Try to terminate the process
            try:
                if os_type == "Windows":
                    # Windows: use taskkill
                    subprocess.run(["taskkill", "/F", "/PID", str(pid)],
                                 capture_output=True, check=False)
                else:
                    # Unix: use os.kill
                    os.kill(pid, signal.SIGTERM)

                print(f"✅ Stopped main backend (PID: {pid})")
            except (ProcessLookupError, PermissionError):
                print("⚠️  Main backend was not running")

            # Remove PID file
            pid_file.unlink()

        except (ValueError, FileNotFoundError) as e:
            print(f"⚠️  Could not read PID file: {e}")
    else:
        print("⚠️  Main backend was not running (no PID file found)")

    # Clean up any orphaned finger tracker processes and free ports
    print("\nCleaning up finger tracker processes and freeing ports...")
    try:
        if os_type == "Windows":
            # Windows: Kill processes using ports 8000 and 9000
            for port in [8000, 9000]:
                result = subprocess.run(
                    ["netstat", "-ano"],
                    capture_output=True,
                    text=True
                )
                for line in result.stdout.split("\n"):
                    if f":{port}" in line and "LISTENING" in line:
                        parts = line.split()
                        if parts:
                            pid = parts[-1]
                            try:
                                subprocess.run(["taskkill", "/F", "/PID", pid],
                                             capture_output=True, check=False)
                                print(f"  Freed port {port} (PID: {pid})")
                            except:
                                pass

            # Wait for ports to be released
            import time
            time.sleep(2)
        else:
            # Unix: use pkill
            subprocess.run(["pkill", "-f", "finger_tracker.py"],
                         capture_output=True, check=False)
    except Exception as e:
        print(f"Note: Could not clean up: {e}")

    print("\n✅ All AccessFlow backends stopped")

if __name__ == "__main__":
    main()
