"""
AccessFlow Backend - FastAPI Server
Handles AI processing for the accessibility companion Chrome extension.
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any
import os
import sys
import json
import subprocess
import signal
import atexit
from dotenv import load_dotenv
from openai import OpenAI

try:
    import anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False

try:
    import openai
    OPENAI_AVAILABLE = True
except ImportError:
    OPENAI_AVAILABLE = False

load_dotenv()

_openai_client = None
def get_openai_client():
    global _openai_client
    if _openai_client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            return None
        _openai_client = OpenAI(api_key=api_key)
    return _openai_client

app = FastAPI(
    title="AccessFlow API",
    description="AI-powered accessibility companion backend",
    version="1.0.0"
)

# Enable CORS for Chrome extension
extension_id = os.getenv("EXTENSION_ID", "*")
cors_origin = f"chrome-extension://{extension_id}" if extension_id != "*" else "*"
app.add_middleware(
    CORSMiddleware,
    allow_origins=[cors_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ========== FINGER TRACKER PROCESS MANAGEMENT ==========
finger_tracker_process = None

def start_finger_tracker():
    """Start the finger tracker subprocess."""
    global finger_tracker_process

    if finger_tracker_process and finger_tracker_process.poll() is None:
        return {"status": "already_running", "message": "Finger tracker is already running"}

    try:
        # Get absolute path to finger_tracker.py
        script_dir = os.path.dirname(os.path.abspath(__file__)) or os.getcwd()
        tracker_script = os.path.join(script_dir, "finger_tracker.py")

        if not os.path.exists(tracker_script):
            return {"status": "error", "message": f"finger_tracker.py not found at {tracker_script}"}

        # Start finger_tracker.py as subprocess
        # On Windows, use CREATE_NEW_CONSOLE to show the camera window
        import platform
        if platform.system() == "Windows":
            # Windows: Create new console window so camera preview is visible
            finger_tracker_process = subprocess.Popen(
                [sys.executable, tracker_script],
                cwd=script_dir,
                creationflags=subprocess.CREATE_NEW_CONSOLE
            )
        else:
            # Unix: Standard subprocess
            finger_tracker_process = subprocess.Popen(
                [sys.executable, tracker_script],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                cwd=script_dir
            )

        return {"status": "started", "message": "Finger tracker started", "pid": finger_tracker_process.pid}
    except Exception as e:
        import traceback
        error_detail = traceback.format_exc()
        print(f"Error starting finger tracker: {error_detail}")
        return {"status": "error", "message": str(e)}

def stop_finger_tracker():
    """Stop the finger tracker subprocess."""
    global finger_tracker_process

    if not finger_tracker_process or finger_tracker_process.poll() is not None:
        finger_tracker_process = None
        return {"status": "not_running", "message": "Finger tracker was not running"}

    try:
        finger_tracker_process.terminate()
        finger_tracker_process.wait(timeout=5)
        finger_tracker_process = None
        return {"status": "stopped", "message": "Finger tracker stopped"}
    except subprocess.TimeoutExpired:
        finger_tracker_process.kill()
        finger_tracker_process = None
        return {"status": "killed", "message": "Finger tracker force-killed"}
    except Exception as e:
        return {"status": "error", "message": str(e)}

atexit.register(stop_finger_tracker)

# ========== END FINGER TRACKER MANAGEMENT ==========


# Request/Response Models
class UserProfile(BaseModel):
    vision: Optional[List[str]] = []
    motor: Optional[List[str]] = []
    cognitive: Optional[List[str]] = []
    hearing: Optional[List[str]] = []


class PageContext(BaseModel):
    url: str = Field(..., max_length=5000)
    title: str = Field(..., max_length=5000)
    headings: Optional[List[Dict[str, str]]] = []
    interactive_elements: Optional[List[Dict[str, Any]]] = []
    landmarks: Optional[List[Dict[str, str]]] = []
    images: Optional[List[Dict[str, str]]] = []
    main_content: Optional[str] = Field(default="", max_length=50000)


class Action(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    direction: Optional[str] = None
    amount: Optional[int] = None
    text: Optional[str] = None
    styles: Optional[Dict[str, str]] = None
    description: Optional[str] = None


# --- Content Description & Narration models (GPT-4o-mini) ---

class ImageItem(BaseModel):
    base64: Optional[str] = Field(default=None, max_length=5000000)   # base64-encoded image data (preferred)
    url: Optional[str] = None      # raw src URL fallback if base64 failed
    original_alt: Optional[str] = None  # existing alt text on the page, if any


class DescribeImagesRequest(BaseModel):
    images: List[ImageItem]
    page_title: Optional[str] = Field(default="", max_length=5000)


class ImageDescription(BaseModel):
    index: int
    description: str


class DescribeImagesResponse(BaseModel):
    descriptions: List[ImageDescription]


class PageSection(BaseModel):
    heading: str = Field(..., max_length=5000)
    text: str = Field(..., max_length=50000)


class NarratePageRequest(BaseModel):
    sections: List[PageSection]
    page_title: Optional[str] = Field(default="", max_length=5000)
    page_url: Optional[str] = Field(default="", max_length=5000)


class NarratePageResponse(BaseModel):
    narration: str


# --- Conversational Narration models ---

class NarrateTopic(BaseModel):
    name: str
    heading_match: str


class NarrateOverviewRequest(BaseModel):
    sections: List[PageSection]
    page_title: Optional[str] = Field(default="", max_length=5000)
    page_url: Optional[str] = Field(default="", max_length=5000)


class NarrateOverviewResponse(BaseModel):
    overview: str
    topics: List[NarrateTopic]


class NarrateTopicRequest(BaseModel):
    topic_name: str = Field(..., max_length=5000)
    section_text: str = Field(..., max_length=50000)
    conversation_history: Optional[List[Dict[str, str]]] = []
    heard_topics: Optional[List[str]] = []
    available_topics: Optional[List[str]] = []


class NarrateTopicResponse(BaseModel):
    narration: str
    follow_up: str


# ========== INTELLIGENT PAGE SIMPLIFICATION ==========

class SimplifyRequest(BaseModel):
    page_url: str = Field(..., max_length=5000)
    page_title: str = Field(..., max_length=5000)
    page_content: str = Field(..., max_length=50000)  # Extracted text content
    user_profile: Optional[UserProfile] = None


class CSSRule(BaseModel):
    selector: str
    property: str
    value: str


class SimplifyResponse(BaseModel):
    css_rules: List[CSSRule]
    summary: str
    changes_description: List[str]


INTERPRET_SYSTEM_PROMPT = """You are the command interpreter for AccessFlow, an accessibility tool. The user speaks a voice command and you determine what action to take on the webpage.

You will receive:
- The user's spoken command
- A list of interactive elements on the page, GROUPED BY PAGE REGION (e.g. MAIN CONTENT, NAV, FOOTER) and pre-sorted by relevance
- Recent conversation history (previous commands and responses) for context

Return ONLY a valid JSON object with this structure:
{
  "action": "click" | "highlight" | "type" | "scroll" | "none",
  "target_index": <index of the element to act on, or null>,
  "value": "<text to type, if action is type, otherwise null>",
  "explanation": "<brief user-friendly message about what you did>",
  "suggestion": "<a short contextual follow-up suggestion for the user>"
}

Rules:
- Elements are grouped by page region and pre-sorted by relevance. Element indices may be non-sequential (they are stable DOM IDs).
- For article/headline/product/content requests, PREFER elements in MAIN CONTENT or ARTICLE regions
- Match elements by fuzzy text similarity — the user won't say exact text
- Prefer partial matches over no match. E.g. "exercising in cold" should match "Is exercising in the cold good for you?"
- If no element matches at all, set action to "none" and explain what went wrong

TEXT EXTRACTION RULES:
When extracting text to type from search commands:
1. Remove the command keyword ("search", "look for", "find") and preposition ("for")
2. Keep EVERYTHING else exactly as the user said it
3. Preserve the user's exact wording - don't paraphrase or summarize
4. Include all modifiers, adjectives, and details

Examples:
- "search for red running shoes" → value: "red running shoes"
- "search climate change" → value: "climate change"
- "look for information about tesla" → value: "information about tesla"
- "find nike air max 2024" → value: "nike air max 2024"
- "search for \"best laptops\"" → value: "best laptops"

CRITICAL: If you're unsure what to extract, include MORE rather than less.

SEARCH INPUT FIELD SELECTION (for "type" actions):
When the user says "search [for] X", you MUST find a search input field using this priority:
1. ✓ HIGHEST PRIORITY: input[type="search"]
2. ✓ HIGH PRIORITY: input with "search"/"query"/"find"/"q" in name attribute
3. ✓ HIGH PRIORITY: input with "search"/"query"/"find" in placeholder text
4. ✓ MEDIUM PRIORITY: input with "search" in aria-label or class
5. ✓ MEDIUM PRIORITY: Text inputs in HEADER or NAV regions
6. ✓ LOW PRIORITY: input[type="text"] with no specific indicators
7. ✗ NEVER use: password, email, tel, date, number, hidden inputs

CRITICAL: For "search" commands, prefer ANY input field over clicking a link.
If multiple inputs exist, prefer the one in header/nav region.
If NO input exists, set action to "none" - explain "No search box found on this page."

Example element selection:
Page has: [12] <input type="email" placeholder="Email"> in MAIN
          [34] <a>images</a> in NAV
          [45] <input type="text" placeholder="Search"> in HEADER
          [78] <button>Search</button> in HEADER

For "search for popmart" → target_index: 45 (the input in header)
NEVER → target_index: 34 (clicking "images" link) ❌

COMMAND CLASSIFICATION - REVISED:

SEARCH COMMANDS (action: "type" into search input):
- "search [for] X" → SEARCH - ONLY type into input field, NEVER EVER click links/buttons
- "find X" → SEARCH (unless "find where X is" → highlight)
- "look for X" → SEARCH (always, no exceptions)
- "look up X" → SEARCH

CRITICAL RULE FOR SEARCH COMMANDS:
If the command starts with "search", "find", "look for", or "look up":
1. You MUST find an input field (search box, text input)
2. You MUST use action: "type"
3. You MUST NEVER use action: "click" - even if X matches a link
4. If no search box exists, set action to "none" - DO NOT click as a fallback

Example: "search for images" → Find search box, TYPE "images", NEVER click "images" link

CLICK COMMANDS (action: "click" on links/buttons):
- "click [on] X" → CLICK
- "open X" → CLICK
- "go to X" → CLICK
- "press X" → CLICK (for buttons)
When navigation intent is clear → CLICK element, never type

BARE PHRASES (no command keyword):
Decision tree for phrases like "climate change":
1. Does page have a search box?
   - YES: Default to SEARCH (user can say "click X" if they want link)
   - NO: Look for matching link → CLICK it
2. If phrase EXACTLY matches a visible link/button AND user recently clicked links → CLICK
3. If phrase is a generic topic/query (2+ words, no article words like "the") → SEARCH

Examples:
- "red shoes" + page has search box → SEARCH for "red shoes"
- "red shoes" + no search box + link exists → CLICK the link
- "climate change article" → CLICK (contains "article")
- "best practices" → SEARCH (generic topic query)

OTHER COMMANDS:
- "highlight X" or "show me X" or "find where X is" → action: "highlight"
- "type X into Y" or "enter X in Y" → action: "type" into specific field Y
- "scroll down/up" → action: "scroll"

CRITICAL: When uncertain between search/click, default to SEARCH (safer, reversible). Never confuse search and click commands.

Conversation context rules:
- Use the conversation history to resolve references like "the first one", "that article", "no the other one", "do that again", "go back"
- If the user says "go back" after clicking a link, they want to navigate back
- If the user says "the first article" or "the second one", resolve the reference using the elements list and conversation context

Suggestion rules — always include a short, helpful follow-up suggestion:
- After clicking a link/article: "Say 'read page' to hear it aloud, or 'go back' to return"
- After scrolling: "Keep scrolling, or say an article title to open it"
- After highlighting an element: "Say 'click' to activate it, or keep browsing"
- After searching (typing into search box): "Results are loading, or say 'scroll down' to browse"
- If no action was taken: "Try saying an article title, or say 'help' for options"
"""


class PageElement(BaseModel):
    index: int
    tag: str           # "a", "button", "input", etc.
    text: str = Field(..., max_length=5000)          # visible text or label
    type: Optional[str] = None  # input type, if applicable
    region: Optional[str] = "other"  # page region: nav, main, article, footer, etc.


class InterpretCommandRequest(BaseModel):
    command: str = Field(..., max_length=5000)
    elements: List[PageElement]
    page_title: Optional[str] = Field(default="", max_length=5000)
    page_url: Optional[str] = Field(default="", max_length=5000)
    conversation_history: Optional[List[Dict[str, str]]] = []


class InterpretCommandResponse(BaseModel):
    action: str
    target_index: Optional[int] = None
    value: Optional[str] = None
    explanation: str
    suggestion: Optional[str] = None


SIMPLIFY_SYSTEM_PROMPT = """You are an accessibility expert. Analyze the webpage and return CSS modifications to improve accessibility. Focus on:

1. Typography: Increase font size (18px+ base), improve line spacing (1.8), use system fonts
2. Contrast: Boost to WCAG AAA 7:1 ratio, use high contrast colors (#000 on #fff)
3. Click Targets: Enlarge to minimum 44x44px, add adequate padding
4. Layout: Simplify to single column, limit line length to 80ch
5. Distractions: Remove animations, background images, auto-playing media
6. Focus States: Add visible focus outlines (3px solid blue)

IMPORTANT: Return ONLY a valid JSON object with no markdown formatting, no code blocks, no extra text. The JSON must have this exact structure:
{
    "css_rules": [
        {"selector": "body", "property": "font-size", "value": "18px"},
        {"selector": "body", "property": "line-height", "value": "1.8"}
    ],
    "summary": "Brief summary of changes made",
    "changes_description": ["Change 1", "Change 2", "Change 3"]
}

Generate CSS rules that will significantly improve accessibility for the given page. Be specific with selectors when possible, but also include broad selectors for general improvements."""


def extract_json(text: str) -> dict:
    if "```json" in text:
        text = text.split("```json")[1].split("```")[0].strip()
    elif "```" in text:
        text = text.split("```")[1].split("```")[0].strip()
    return json.loads(text)


@app.get("/")
async def root():
    return {"message": "AccessFlow API is running", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


@app.post("/api/finger-tracker/start")
async def api_start_finger_tracker():
    """Start the finger tracker service."""
    result = start_finger_tracker()
    return result


@app.post("/api/finger-tracker/stop")
async def api_stop_finger_tracker():
    """Stop the finger tracker service."""
    result = stop_finger_tracker()
    return result


@app.get("/api/finger-tracker/status")
async def api_finger_tracker_status():
    """Check if finger tracker is running."""
    global finger_tracker_process
    is_running = finger_tracker_process is not None and finger_tracker_process.poll() is None
    return {
        "running": is_running,
        "pid": finger_tracker_process.pid if is_running else None
    }


# --- Content Description & Narration endpoints (GPT-4o-mini) ---

def _build_image_content_block(image: ImageItem) -> dict:
    """Convert an ImageItem into a GPT-4 vision content block."""
    if image.base64:
        return {
            "type": "image_url",
            "image_url": {
                "url": f"data:image/png;base64,{image.base64}",
                "detail": "low"
            }
        }
    if image.url:
        return {
            "type": "image_url",
            "image_url": {
                "url": image.url,
                "detail": "low"
            }
        }
    return None


@app.post("/api/describe-images", response_model=DescribeImagesResponse)
async def describe_images(request: DescribeImagesRequest):
    """
    Describe images on the page using GPT-4o-mini Vision.
    Accepts images as base64 or URL. Returns a description for each.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")
    descriptions = []

    for idx, image in enumerate(request.images):
        image_block = _build_image_content_block(image)
        if not image_block:
            descriptions.append(ImageDescription(index=idx, description="Could not access this image."))
            continue

        messages = [
            {
                "role": "user",
                "content": [
                    image_block,
                    {
                        "type": "text",
                        "text": (
                            "Describe this image in 1-2 sentences for a visually impaired user. "
                            "Focus on: what is depicted, any text visible in the image, and its significance. "
                            "Be concise and clear."
                        )
                    }
                ]
            }
        ]

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                max_tokens=150
            )
            desc_text = response.choices[0].message.content.strip()
        except Exception as e:
            desc_text = f"Could not describe this image: {str(e)}"

        descriptions.append(ImageDescription(index=idx, description=desc_text))

    return DescribeImagesResponse(descriptions=descriptions)


@app.post("/api/narrate-page", response_model=NarratePageResponse)
async def narrate_page(request: NarratePageRequest):
    """
    Generate an accessibility-friendly narration of the page using GPT-4o-mini.
    Accepts page sections (heading + text) and returns a structured narration.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    sections_text = "\n".join(
        f"[{s.heading}]\n{s.text}" for s in request.sections
    )

    prompt = (
        f"Page title: {request.page_title}\n"
        f"Page URL: {request.page_url}\n\n"
        f"Page content broken into sections:\n{sections_text}\n\n"
        "Provide an accessibility-friendly narration of this webpage. "
        "Structure your narration as:\n"
        "1. One-sentence page summary (what is this page for?)\n"
        "2. Available navigation options (where can the user go?)\n"
        "3. Main content summary (what is the key information?)\n"
        "4. Available actions (what can the user do here?)\n\n"
        "Keep each section to 2-3 sentences maximum. "
        "Use plain language — reading level of grade 8 or lower."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=400
        )
        narration = response.choices[0].message.content.strip()
    except Exception as e:
        narration = f"Could not narrate this page: {str(e)}"

    return NarratePageResponse(narration=narration)


# ========== CONVERSATIONAL NARRATION ENDPOINTS ==========

@app.post("/api/narrate-overview", response_model=NarrateOverviewResponse)
async def narrate_overview(request: NarrateOverviewRequest):
    """
    Analyze page sections and return a natural overview with available topics.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    sections_text = "\n".join(
        f"[{s.heading}]\n{s.text[:300]}" for s in request.sections
    )

    prompt = (
        f"Page title: {request.page_title}\n"
        f"Page URL: {request.page_url}\n\n"
        f"Page sections:\n{sections_text}\n\n"
        "You are a friendly guide helping a user explore this webpage. "
        "Analyze the page and return a JSON object with:\n"
        "1. \"overview\": A natural 2-3 sentence summary of what this page is about, "
        "ending with \"What would you like to hear about?\"\n"
        "2. \"topics\": An array of the main topics/sections available, each with:\n"
        "   - \"name\": A clean, short topic name (e.g. \"Career\" not \"Career and filmography\")\n"
        "   - \"heading_match\": The original section heading it maps to\n\n"
        "Keep topic names to 1-3 words. Merge related small sections into one topic. "
        "Aim for 3-8 topics total.\n\n"
        "Return ONLY valid JSON, no markdown."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=300,
            temperature=0.3
        )
        response_text = response.choices[0].message.content.strip()

        data = extract_json(response_text)
        topics = [NarrateTopic(**t) for t in data.get("topics", [])]
        return NarrateOverviewResponse(
            overview=data.get("overview", "Here's what's on this page."),
            topics=topics
        )
    except Exception as e:
        return NarrateOverviewResponse(
            overview=f"This is a page titled {request.page_title}. What would you like to hear about?",
            topics=[NarrateTopic(name=s.heading[:30], heading_match=s.heading) for s in request.sections[:8]]
        )


@app.post("/api/narrate-topic", response_model=NarrateTopicResponse)
async def narrate_topic(request: NarrateTopicRequest):
    """
    Narrate a specific topic section naturally and suggest what to hear next.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    # Build conversation context
    history_text = ""
    if request.conversation_history:
        history_lines = [f"{e.get('role','user')}: {e.get('text','')}" for e in request.conversation_history[-6:]]
        history_text = "Previous conversation:\n" + "\n".join(history_lines) + "\n\n"

    # Build available topics hint
    remaining = [t for t in request.available_topics if t not in request.heard_topics and t != request.topic_name]
    remaining_text = ", ".join(remaining[:4]) if remaining else "no other topics"

    prompt = (
        f"{history_text}"
        f"Topic: {request.topic_name}\n\n"
        f"Content:\n{request.section_text[:4000]}\n\n"
        f"Other available topics the user hasn't heard yet: {remaining_text}\n\n"
        "You are a friendly guide narrating this topic for a user with accessibility needs. "
        "Return a JSON object with:\n"
        "1. \"narration\": A natural 4-6 sentence summary of this topic. Be conversational, "
        "not robotic. Include the most interesting or important facts.\n"
        "2. \"follow_up\": A short 1-sentence suggestion of what to hear next, mentioning "
        "1-2 of the remaining topics. If no topics remain, say something like "
        "\"That covers everything! Say 'done' when you're finished.\"\n\n"
        "Return ONLY valid JSON, no markdown."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=350,
            temperature=0.4
        )
        response_text = response.choices[0].message.content.strip()

        data = extract_json(response_text)
        return NarrateTopicResponse(
            narration=data.get("narration", "Here's what I found about this topic."),
            follow_up=data.get("follow_up", "What else would you like to know?")
        )
    except Exception as e:
        return NarrateTopicResponse(
            narration=request.section_text[:500],
            follow_up="What else would you like to hear about?"
        )


# ========== AI COMMAND INTERPRETER ENDPOINT ==========

@app.post("/api/interpret-command", response_model=InterpretCommandResponse)
async def interpret_command(request: InterpretCommandRequest):
    """
    Use GPT-4o-mini to interpret a natural-language voice command
    and map it to a page action (click, highlight, type, scroll).
    """
    client = get_openai_client()
    if not client:
        return InterpretCommandResponse(action="none", explanation="AI not configured (no OPENAI_API_KEY).")

    # Build the element list grouped by region (cap at 120, frontend pre-sorts by priority)
    REGION_ORDER = ["main", "article", "form", "other", "header", "nav", "sidebar", "footer"]
    capped = request.elements[:120]
    grouped: Dict[str, list] = {}
    for el in capped:
        r = el.region or "other"
        grouped.setdefault(r, []).append(el)

    region_blocks = []
    for region in REGION_ORDER:
        items = grouped.pop(region, [])
        if not items:
            continue
        label = region.upper().replace("OTHER", "OTHER CONTENT")
        region_blocks.append(f"--- {label} ({len(items)} items) ---")
        for el in items:
            region_blocks.append(f"  [{el.index}] <{el.tag}> \"{el.text}\"")
    # Any remaining regions not in REGION_ORDER
    for region, items in grouped.items():
        region_blocks.append(f"--- {region.upper()} ({len(items)} items) ---")
        for el in items:
            region_blocks.append(f"  [{el.index}] <{el.tag}> \"{el.text}\"")
    elements_text = "\n".join(region_blocks)

    # Build conversation history context
    history_text = ""
    if request.conversation_history:
        history_lines = []
        for entry in request.conversation_history[-10:]:
            role = entry.get("role", "user")
            text = entry.get("text", "")
            history_lines.append(f"  {role}: {text}")
        history_text = "Recent conversation:\n" + "\n".join(history_lines) + "\n\n"

    user_prompt = (
        f"Page: {request.page_title} ({request.page_url})\n\n"
        f"{history_text}"
        f"User's voice command: \"{request.command}\"\n\n"
        f"Interactive elements on the page:\n{elements_text}\n\n"
        "What action should be taken? Return ONLY the JSON object."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": INTERPRET_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=350,
            temperature=0.25
        )
        response_text = response.choices[0].message.content.strip()

        data = extract_json(response_text)
        return InterpretCommandResponse(
            action=data.get("action", "none"),
            target_index=data.get("target_index"),
            value=data.get("value"),
            explanation=data.get("explanation", "Done."),
            suggestion=data.get("suggestion")
        )
    except Exception as e:
        return InterpretCommandResponse(
            action="none", explanation=f"Could not interpret command: {str(e)}"
        )


# ========== INTELLIGENT PAGE SIMPLIFICATION ENDPOINT ==========

@app.post("/api/simplify", response_model=SimplifyResponse)
async def simplify_page(request: SimplifyRequest):
    """
    Analyze a webpage and return AI-generated CSS modifications for accessibility.

    This endpoint receives:
    - page_url: URL of the current webpage
    - page_title: Title of the webpage
    - page_content: Text content from the page (first 5000 chars)
    - user_profile: Optional user accessibility preferences

    Returns:
    - css_rules: List of CSS rules to apply
    - summary: Brief description of changes
    - changes_description: List of specific changes made
    """

    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    # Check if we have any AI provider available
    has_openai = get_openai_client() is not None and OPENAI_AVAILABLE
    has_anthropic = anthropic_key and ANTHROPIC_AVAILABLE

    if not has_openai and not has_anthropic:
        # Return balanced accessibility improvements if no API key
        return SimplifyResponse(
            css_rules=[
                # Larger, readable text (scale up proportionally)
                CSSRule(selector="html", property="font-size", value="120%"),
                CSSRule(selector="body", property="line-height", value="1.7"),
                CSSRule(selector="p, li, td, th, span, div", property="line-height", value="1.7"),

                # Improve text readability
                CSSRule(selector="body", property="font-family", value="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"),
                CSSRule(selector="p, li", property="letter-spacing", value="0.01em"),
                CSSRule(selector="p, li", property="word-spacing", value="0.05em"),

                # Better contrast for text (but preserve layout colors)
                CSSRule(selector="p, span, li, td, th, label", property="color", value="#1a1a1a"),
                CSSRule(selector="h1, h2, h3, h4, h5, h6", property="color", value="#000"),
                CSSRule(selector="a", property="color", value="#0066cc"),
                CSSRule(selector="a", property="text-decoration", value="underline"),

                # Hide ads and distractions (but keep layout)
                CSSRule(selector="[class*='advert'], [class*='ad-container'], [class*='sponsor'], [id*='ad-']", property="display", value="none"),
                CSSRule(selector="[class*='popup'], [class*='modal'], [class*='overlay']:not(#accessflow)", property="display", value="none"),
                CSSRule(selector="[class*='cookie'], [class*='consent'], [class*='banner']", property="display", value="none"),

                # Bigger click targets
                CSSRule(selector="a, button, [role='button']", property="min-height", value="44px"),
                CSSRule(selector="a, button, [role='button']", property="min-width", value="44px"),
                CSSRule(selector="input, select, textarea", property="min-height", value="44px"),
                CSSRule(selector="input, select, textarea", property="padding", value="8px 12px"),

                # Remove distracting animations
                CSSRule(selector="*", property="animation-duration", value="0.001s"),
                CSSRule(selector="*", property="transition-duration", value="0.001s"),

                # Clear focus indicators
                CSSRule(selector=":focus", property="outline", value="3px solid #0066cc"),
                CSSRule(selector=":focus", property="outline-offset", value="2px"),

                # Better spacing
                CSSRule(selector="p", property="margin-bottom", value="1em"),
                CSSRule(selector="img", property="max-width", value="100%"),
            ],
            summary="Applied balanced accessibility improvements (no API key configured)",
            changes_description=[
                "Increased text size by 20%",
                "Improved line spacing to 1.7",
                "Enhanced text contrast",
                "Made links more visible with underlines",
                "Hidden ads, popups, and cookie banners",
                "Enlarged click targets to 44px minimum",
                "Disabled distracting animations",
                "Added clear focus indicators"
            ]
        )

    # Build the prompt for the AI
    user_prompt = f"""Analyze this webpage and generate CSS rules to improve its accessibility:

URL: {request.page_url}
Title: {request.page_title}

Page Content (excerpt):
{request.page_content[:3000]}

{f"User has these accessibility needs: {request.user_profile.model_dump_json()}" if request.user_profile else ""}

Based on this page's purpose and content, generate specific CSS rules to make it more accessible. Consider:
- What type of page is this? (news, e-commerce, form, article, etc.)
- What are the key interactive elements?
- What would help users with vision, motor, or cognitive needs?

Return ONLY the JSON object, no other text."""

    try:
        response_text = ""

        if has_openai:
            # Use OpenAI
            client = get_openai_client()
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {"role": "system", "content": SIMPLIFY_SYSTEM_PROMPT},
                    {"role": "user", "content": user_prompt}
                ],
                max_tokens=2048,
                temperature=0.3
            )
            response_text = response.choices[0].message.content.strip()

        elif has_anthropic:
            # Use Anthropic
            client = anthropic.Anthropic(api_key=anthropic_key)
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=2048,
                messages=[
                    {"role": "user", "content": user_prompt}
                ],
                system=SIMPLIFY_SYSTEM_PROMPT
            )
            response_text = message.content[0].text.strip()

        # Try to extract JSON from the response
        data = extract_json(response_text)

        css_rules = [CSSRule(**rule) for rule in data.get("css_rules", [])]

        return SimplifyResponse(
            css_rules=css_rules,
            summary=data.get("summary", "Page simplified for accessibility"),
            changes_description=data.get("changes_description", ["Accessibility improvements applied"])
        )

    except json.JSONDecodeError as e:
        # If JSON parsing fails, return default rules
        return SimplifyResponse(
            css_rules=[
                CSSRule(selector="html, body", property="font-size", value="18px"),
                CSSRule(selector="body", property="line-height", value="1.8"),
                CSSRule(selector="body", property="color", value="#000"),
                CSSRule(selector="body", property="background-color", value="#fff"),
            ],
            summary="Applied basic accessibility improvements (AI response parsing failed)",
            changes_description=["Basic font and contrast improvements applied"]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing request: {str(e)}")


# ========== TEXT-TO-SPEECH ENDPOINT ==========

class TTSRequest(BaseModel):
    text: str = Field(..., max_length=5000)
    voice: Optional[str] = "nova"  # nova, alloy, echo, fable, onyx, shimmer


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to natural-sounding speech using OpenAI TTS.
    Returns audio/mpeg binary data.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    try:
        response = client.audio.speech.create(
            model="tts-1",
            voice=request.voice,
            input=request.text,
            speed=1.0
        )
        audio_bytes = response.content
        return Response(content=audio_bytes, media_type="audio/mpeg")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS error: {str(e)}")


# ========== ACCESSIBILITY SUMMARY ENDPOINT ==========

class AccessibilitySummaryRequest(BaseModel):
    report: Dict[str, Any]


class AccessibilitySummaryResponse(BaseModel):
    summary: str


@app.post("/api/accessibility-summary", response_model=AccessibilitySummaryResponse)
async def accessibility_summary(request: AccessibilitySummaryRequest):
    """
    Generate a conversational AI summary of an accessibility scan report.
    """
    client = get_openai_client()
    if not client:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    report = request.report
    categories = report.get("categories", {})

    # Build a concise summary of findings for the LLM
    findings = []
    for key, cat in categories.items():
        issues = cat.get("issues", cat.get("deductions", []))
        findings.append(f"- {key}: {cat.get('score', 0)}% ({len(issues)} issues)")

    prompt = (
        f"You are an accessibility expert reviewing a webpage scan.\n\n"
        f"Page: {report.get('url', 'unknown')}\n"
        f"Overall Score: {report.get('overallScore', 0)}/100 (Grade: {report.get('grade', '-')})\n\n"
        f"Category scores:\n" + "\n".join(findings) + "\n\n"
        f"Top issues found:\n"
    )

    # Add top 8 issues
    all_issues = []
    for cat in categories.values():
        for issue in cat.get("issues", cat.get("deductions", []))[:3]:
            all_issues.append(f"  [{issue.get('severity', 'info')}] {issue.get('issue', '')}")
    prompt += "\n".join(all_issues[:8])

    prompt += (
        "\n\nProvide a 3-4 sentence summary of the accessibility state of this page. "
        "Then give the top 3 specific, actionable recommendations to improve the score. "
        "Be conversational and practical — avoid jargon. Keep it under 150 words."
    )

    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            max_tokens=250,
            temperature=0.4
        )
        summary = response.choices[0].message.content.strip()
        return AccessibilitySummaryResponse(summary=summary)
    except Exception as e:
        return AccessibilitySummaryResponse(summary=f"Could not generate summary: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
