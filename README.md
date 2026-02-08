# AccessFlow

**AI-Powered Adaptive Accessibility Companion**

> Make any website accessible through voice, gestures, and AI — no developer changes required.

AccessFlow is a Chrome extension that brings real-time accessibility to **any website** for users with visual, motor, cognitive, or auditory impairments. It combines voice control, hand gesture tracking, AI-powered page adaptation, and color vision support into a single unified tool.

## Problem

Despite rapid digital innovation, most websites remain inaccessible due to rigid one-size-fits-all designs, complex interfaces, and a lack of multimodal alternatives. Users with disabilities are forced to rely on fragmented, developer-dependent tools that rarely work across platforms. AccessFlow solves this by injecting accessibility features directly into any webpage at runtime.

## Features

### Voice Control
- **Natural language commands**: Say "click login", "search for shoes", "scroll down", or "go back"
- **AI command interpretation**: GPT-4o-mini interprets ambiguous commands by analyzing interactive page elements, so "open the first article" just works
- **Continuous listening**: Mic stays open across commands with echo cancellation
- **Keyboard shortcut**: `Ctrl+Shift+V` / `Cmd+Shift+V` to toggle mic

### Finger Tracking & Gesture Control
- **Real-time hand tracking** via webcam using MediaPipe
- **Cursor control**: Point your index finger to move a virtual cursor on the page
- **L-shape gesture click**: Form an L-shape with thumb and index finger to click
- **Scroll mode**: Pinch and drag to scroll pages
- **Hover feedback**: Visual outlines on elements as you point at them

### Color Blind Filters
- **Three types**: Deuteranopia, Protanopia, Tritanopia
- **Two modes**:
  - **Correct** (Daltonization): Shifts indistinguishable colors into visible channels so color-blind users can tell them apart
  - **Simulate**: Shows what the page looks like through color-blind eyes (for developers/designers testing their UI)
- Implemented via SVG `feColorMatrix` filters using Machado 2009 simulation matrices
- Preferences persist across sessions

### AI Page Simplification
- One-click AI analysis of page structure and content
- GPT-4o-mini generates targeted CSS rules to reduce visual complexity
- Hides clutter, improves spacing, and enhances readability

### Read Page (Conversational Narration)
- AI generates a structured overview of any webpage
- **Topic-based navigation**: Click topic chips or say a topic name to hear about it
- **Conversational follow-ups**: Ask questions about what was just read
- **Read Everything**: Sequential narration of all page sections
- Natural TTS via OpenAI API with browser fallback

### Describe Images
- Finds all meaningful images on a page (skips decorative ones)
- GPT-4o-mini with vision generates natural descriptions
- Sequential auto-narration with Next/Stop controls

### Inclusive Mode
- Increases font size, line height, letter spacing, and tap target sizes
- Adjustable font size slider (10px–40px)
- Works on dynamic sites (Google, SPAs) via MutationObserver and continuous re-application
- Injects into Shadow DOM for web component support

### Focus Mode
- Hides distracting page elements (ads, sidebars, nav, popups, modals)
- **Three intensity levels**:
  - **Light**: Ads, popups, cookie banners only
  - **Medium**: + sidebars, nav, footer
  - **Strong**: + headers, comments, social share buttons, newsletters
- Highlights main content area

### Task Tunnel
- Step-by-step form navigation for long or complex forms
- Groups radio buttons and checkboxes intelligently
- Floating overlay with Prev/Next/Exit controls and step counter
- Auto-detects dynamically added form fields via MutationObserver

### Auto-Suggest
- Analyzes page on load (font sizes, nav link count, word density, missing alt text)
- Suggests relevant accessibility modes via a dismissible banner

### User Profiles & Preferences
- Saves active modes, font size, intensity, color blind filter/mode to Chrome storage
- Auto-applies saved preferences on extension load
- Settings panel with auto-start voice input and auto-read options

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Extension | Chrome Manifest V3, Side Panel API |
| Backend | FastAPI (Python), Uvicorn |
| AI Models | GPT-4o-mini (commands, narration, images, simplification, TTS), Claude Sonnet (fallback) |
| Voice | Web Speech API (STT), OpenAI TTS API |
| Gesture | MediaPipe Hand Tracking, OpenCV, WebSocket |
| Color Blind | SVG feColorMatrix filters (Machado 2009) |
| Storage | Chrome Storage API (sync + local) |

## Project Structure

```
AccessFlow/
├── accessflow-backend/          # Python FastAPI backend
│   ├── main.py                  # API server (13 endpoints)
│   ├── finger_tracker.py        # MediaPipe hand tracking + WebSocket
│   ├── requirements.txt         # Python dependencies
│   └── .env.example             # Environment variables template
│
├── accessflow-extension/        # Chrome Extension (Manifest V3)
│   ├── manifest.json            # Extension configuration
│   ├── background.js            # Service worker + WebSocket relay
│   ├── content.js               # Page interaction (modes, filters, commands)
│   ├── sidepanel.html           # Side panel UI
│   ├── sidepanel.js             # Side panel logic + voice + state
│   └── styles.css               # Extension styling
│
├── start-accessflow.py          # Cross-platform startup script
├── stop-accessflow.py           # Cross-platform stop script
├── start-accessflow.sh          # macOS/Linux startup
└── start-accessflow.bat         # Windows startup
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | API status |
| GET | `/health` | Health check |
| POST | `/api/interpret-command` | AI voice command interpretation |
| POST | `/api/simplify` | AI page simplification |
| POST | `/api/describe-images` | GPT-4o-mini vision image descriptions |
| POST | `/api/narrate-overview` | Page overview + topic extraction |
| POST | `/api/narrate-topic` | Conversational topic narration |
| POST | `/api/tts` | OpenAI text-to-speech |
| POST | `/api/chat` | General chat with page context |
| POST | `/api/finger-tracker/start` | Start hand tracking subprocess |
| POST | `/api/finger-tracker/stop` | Stop hand tracking |
| GET | `/api/finger-tracker/status` | Tracker status |

## Quick Start

### Prerequisites
- Python 3.8+
- Google Chrome
- OpenAI API key

### 1. Clone and install

```bash
git clone https://github.com/ajiteshmanoj/AccessFlow.git
cd AccessFlow
cd accessflow-backend
python -m venv venv
source venv/bin/activate        # macOS/Linux
# venv\Scripts\activate         # Windows
pip install -r requirements.txt
cp .env.example .env
# Edit .env and add: OPENAI_API_KEY=sk-...
```

### 2. Start the backend

```bash
cd ..
python start-accessflow.py
```

The API will be available at `http://localhost:8000`.

### 3. Load the Chrome extension

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** and select the `accessflow-extension` folder
4. The AccessFlow icon appears in your toolbar

### 4. Use it

1. Open any website
2. Click the AccessFlow icon to open the side panel
3. Try voice commands (click the mic or press `Ctrl+Shift+V`):
   - "search for headphones"
   - "click the first result"
   - "scroll down"
   - "simplify page"
   - "describe images"
   - "color blind"

## Voice Commands

### Page interaction
| Command | Action |
|---------|--------|
| "click [element]" | Click a button, link, or interactive element |
| "search for [query]" | Find search box, type query, and submit |
| "type [field] [text]" | Type text into a specific input field |
| "highlight [element]" | Highlight an element on the page |
| "scroll down / up" | Scroll the page |
| "go back / forward" | Browser navigation |
| "close ad / popup" | Find and click close buttons |
| "first / second article" | Click nth element by type |

### Extension features
| Command | Action |
|---------|--------|
| "inclusive mode" | Toggle Inclusive Mode |
| "focus mode" | Toggle Focus Mode |
| "simplify page" | Toggle AI simplification |
| "color blind" | Toggle color blind filter |
| "read page" | Start page narration |
| "describe images" | Describe images with AI |
| "finger tracking" | Start gesture control |
| "bigger text" / "smaller text" | Adjust font size |
| "reset" | Reset all modes |

## Stopping the Backend

```bash
python stop-accessflow.py
```

## Troubleshooting

### Port already in use (Windows)
```batch
stop-accessflow.bat
# Or manually:
netstat -ano | findstr :8000
taskkill /F /PID <PID>
```

### Finger tracker not starting
1. Ensure webcam is not in use by another app
2. Try running manually: `cd accessflow-backend && python finger_tracker.py`
3. Check that MediaPipe and OpenCV are installed

### Extension not loading
1. Go to `chrome://extensions`, click Reload on AccessFlow
2. Open DevTools (F12) and check for errors in the console

## License

MIT
