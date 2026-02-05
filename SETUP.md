# AccessFlow Setup Guide

## Quick Start (macOS/Linux)

### 1. Install Dependencies

```bash
cd accessflow-backend
pip3 install -r requirements.txt
```

### 2. Configure API Key

Create a `.env` file in the `accessflow-backend` folder:

```bash
cd accessflow-backend
cp .env.example .env
```

Edit `.env` and add your OpenAI API key:
```
OPENAI_API_KEY=your_key_here
```

### 3. Start AccessFlow

**Option A: Double-click** `start-accessflow.sh` in Finder

**Option B: Run in Terminal**
```bash
cd AccessFlow
./start-accessflow.sh
```

You should see:
```
✅ AccessFlow backends started!

📊 Status:
   Main backend: http://localhost:8000
   Finger tracker: ws://localhost:9000
```

### 4. Load Extension in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `accessflow-extension` folder
5. Click the **AccessFlow icon** in your toolbar

### 5. Grant Permissions

When using finger tracking for the first time:
- macOS will ask for **Camera permission** for Terminal
- Click **OK** to allow

---

## Stopping AccessFlow

```bash
./stop-accessflow.sh
```

Or simply close the terminal window.

---

## Troubleshooting

### "Backends not running" message in extension

Run the startup script:
```bash
cd ~/Desktop/AccessFlow
./start-accessflow.sh
```

### Check if backends are running

```bash
# Check main backend
curl http://localhost:8000/health

# Check finger tracker
lsof -i :9000
```

### View logs

```bash
# Main backend logs
tail -f /tmp/accessflow-main.log

# Finger tracker logs
tail -f /tmp/accessflow-tracker.log
```

### Port already in use

Stop all backends first:
```bash
./stop-accessflow.sh
```

Then restart:
```bash
./start-accessflow.sh
```

---

## Features

✅ **Inclusive Mode** - Bigger text, buttons, better readability
✅ **Focus Mode** - Hide clutter, highlight main content
✅ **Task Tunnel** - Step-by-step form filling
✅ **AI Simplify** - Smart page layout simplification
✅ **Image Descriptions** - AI describes images (GPT-4o-mini)
✅ **Page Narration** - AI reads and explains pages
✅ **Voice Control** - Natural language commands
✅ **Finger Tracking** - Hands-free cursor control via webcam

---

## Support

For issues, check the logs:
- Main backend: `/tmp/accessflow-main.log`
- Finger tracker: `/tmp/accessflow-tracker.log`
