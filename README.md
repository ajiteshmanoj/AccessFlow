# AccessFlow

AI-Powered Adaptive Accessibility Companion

> "Make any website usable through conversation."

AccessFlow is a Chrome extension that makes any website accessible for people with visual, motor, cognitive, or auditory impairments through natural conversation and real-time UI adaptation.

## Project Structure

```
INTUITION/
├── accessflow-backend/     # Python FastAPI backend
│   ├── main.py             # API server with /api/chat endpoint
│   ├── requirements.txt    # Python dependencies
│   └── .env.example        # Environment variables template
│
├── accessflow-extension/   # Chrome Extension (Manifest V3)
│   ├── manifest.json       # Extension configuration
│   ├── background.js       # Service worker
│   ├── content.js          # Page interaction script
│   ├── sidepanel.html      # Side panel UI
│   ├── sidepanel.js        # Side panel logic
│   └── styles.css          # Styling
│
└── AccessFlow_Hackathon_Guide.pdf  # Build guide
```

## Quick Start

### Prerequisites
- Python 3.8 or higher
- Google Chrome browser
- Git (optional, for cloning)

### Step 1: Get the Code
```bash
git clone https://github.com/ajiteshmanoj/AccessFlow.git
cd AccessFlow
```

Or download and extract the ZIP file.

### Step 2: Install Backend Dependencies
```bash
cd accessflow-backend

# Create virtual environment
python -m venv venv

# Activate virtual environment
# On Windows:
venv\Scripts\activate
# On macOS/Linux:
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file from example
# On Windows: copy .env.example .env
# On macOS/Linux: cp .env.example .env

# Edit .env and add your OPENAI_API_KEY
# Example: OPENAI_API_KEY=sk-proj-...
```

### Step 3: Start the Backend
```bash
# Go back to the main AccessFlow directory
cd ..

# Start the backend (auto-detects your OS)
python start-accessflow.py
```

You should see: `✅ AccessFlow backend started!`

**Alternative startup options:**

Platform-specific scripts:
- macOS/Linux: `./start-accessflow.sh`
- Windows: `start-accessflow.bat`

Or run manually:
```bash
cd accessflow-backend
python main.py
```

The API will be available at `http://localhost:8000`

**To stop the backends:**
```bash
python stop-accessflow.py
```

### Step 4: Load Chrome Extension

1. Open Google Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Navigate to and select the `accessflow-extension` folder
5. The AccessFlow icon will appear in your Chrome toolbar

### Step 5: Start Using AccessFlow!

1. Click the AccessFlow icon to open the side panel
2. Try these features:
   - **Voice commands**: Click the microphone button or press `Ctrl+Shift+V` (Windows) / `Cmd+Shift+V` (Mac)
   - **Type**: Say "type toilet paper" to search
   - **Click**: Say "click search button"
   - **Navigate**: Say "scroll down", "go back"
   - **Narrate**: Say "narrate page" to hear page content
   - **Finger tracking**: Click "Start Finger Tracker" for gesture control

## Features

- **Conversational Navigation**: Voice/text control of any webpage
- **Intelligent Page Simplification**: AI-driven UI adaptation
- **Content Description & Narration**: Vision-powered accessibility
- **User Profiles**: Adaptive behavior based on accessibility needs

## Tech Stack

| Component | Technology |
|-----------|------------|
| Extension | Chrome Manifest V3 |
| Backend | FastAPI (Python) |
| AI Model | Claude Sonnet API |
| Voice | Web Speech API |

## API Endpoints

- `GET /` - Health check
- `GET /health` - Server status
- `POST /api/chat` - Process user message with page context

## License

MIT License - See individual component folders for details.
