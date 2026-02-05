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

### Backend Setup

```bash
cd accessflow-backend

# Create virtual environment
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY

# Run the server
uvicorn main:app --reload
```

The API will be available at `http://localhost:8000`

### Extension Setup

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `accessflow-extension` folder
5. The AccessFlow icon will appear in your toolbar

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
