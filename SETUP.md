# AccessFlow Setup Guide

## macOS / Linux

### 1. Install dependencies

```bash
cd accessflow-backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### 2. Configure API key

```bash
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:

```
OPENAI_API_KEY=sk-...
```

### 3. Start AccessFlow

**Option A: Python script (recommended)**

```bash
python start-accessflow.py
```

**Option B: Shell script**

```bash
./start-accessflow.sh
```

You should see:

```
AccessFlow backends started!

Status:
   Main backend: http://localhost:8000
   Finger tracker: ws://localhost:9000
```

### 4. Stop AccessFlow

```bash
python stop-accessflow.py
# or
./stop-accessflow.sh
```

---

## Windows

### 1. Install dependencies

```batch
cd accessflow-backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configure API key

```batch
copy .env.example .env
```

Edit `.env` and add your OpenAI API key.

### 3. Start AccessFlow

**Option A: Python script (recommended)**

```batch
python start-accessflow.py
```

**Option B: Batch file**

Double-click `start-accessflow.bat` or run:

```batch
start-accessflow.bat
```

### 4. Stop AccessFlow

```batch
python stop-accessflow.py
```

Or run `stop-accessflow.bat`, which kills processes on ports 8000 and 9000.

---

## Load the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `accessflow-extension` folder
5. Click the **AccessFlow** icon in your toolbar to open the side panel

### Permissions

- **Camera** (for finger tracking): macOS will prompt for camera permission for Terminal/Python when you first start finger tracking. Click **OK** to allow.
- **Microphone** (for voice): The extension uses an offscreen document to trigger the `getUserMedia` prompt before starting speech recognition.

---

## Health Checks

Verify the backends are running:

```bash
# Main backend
curl http://localhost:8000/health
# Expected: {"status":"healthy"}

# Finger tracker status
curl http://localhost:8000/api/finger-tracker/status
# Expected: {"running":false,"pid":null}  (until you start it from the extension)
```

---

## Log Locations

| Platform | Main Backend | Finger Tracker |
|----------|-------------|----------------|
| macOS/Linux | `/tmp/accessflow-main.log` | `/tmp/accessflow-tracker.log` |
| Windows | `%TEMP%\accessflow-main.log` | Console window |

---

## Troubleshooting

### Port already in use

**macOS/Linux:**

```bash
# Check what's using the port
lsof -i :8000
lsof -i :9000

# Stop all AccessFlow processes
python stop-accessflow.py
```

**Windows:**

```batch
REM Check what's using the port
netstat -ano | findstr :8000

REM Kill the process by PID
taskkill /F /PID <PID>

REM Or use the stop script
stop-accessflow.bat
```

### Finger tracker not starting

1. Ensure your webcam is not in use by another app (Zoom, FaceTime, etc.)
2. Try running manually to see errors:
   ```bash
   cd accessflow-backend
   python finger_tracker.py
   ```
3. Verify MediaPipe and OpenCV are installed:
   ```bash
   pip install mediapipe opencv-python
   ```
4. Check that `hand_landmarker.task` exists in `accessflow-backend/`

### Extension not loading or not connecting

1. Go to `chrome://extensions`, click **Reload** on AccessFlow
2. Open DevTools (F12) → Console tab and check for errors
3. Ensure the backend is running at `http://localhost:8000`
4. If the side panel doesn't open, click the AccessFlow icon in the toolbar

### Voice not working

1. Ensure you're on an `http://` or `https://` page (not `chrome://` or `chrome-extension://`)
2. Allow microphone permissions when prompted
3. Check that the mic icon in the side panel is active (highlighted)
4. On restricted pages (like `chrome://newtab`), AccessFlow auto-navigates to google.com

### "Backends not running" message

Run the startup script from the project root:

```bash
python start-accessflow.py
```

Then reload the extension at `chrome://extensions`.
