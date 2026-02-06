"""
AccessFlow Backend - FastAPI Server
Handles AI processing for the accessibility companion Chrome extension.
"""

from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
import json
import subprocess
import signal
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

app = FastAPI(
    title="AccessFlow API",
    description="AI-powered accessibility companion backend",
    version="1.0.0"
)

# Enable CORS for Chrome extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
        # Start finger_tracker.py as subprocess
        finger_tracker_process = subprocess.Popen(
            ["python3", "finger_tracker.py"],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            cwd=os.path.dirname(__file__)
        )
        return {"status": "started", "message": "Finger tracker started", "pid": finger_tracker_process.pid}
    except Exception as e:
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

# ========== END FINGER TRACKER MANAGEMENT ==========


# Request/Response Models
class UserProfile(BaseModel):
    vision: Optional[List[str]] = []
    motor: Optional[List[str]] = []
    cognitive: Optional[List[str]] = []
    hearing: Optional[List[str]] = []


class PageContext(BaseModel):
    url: str
    title: str
    headings: Optional[List[Dict[str, str]]] = []
    interactive_elements: Optional[List[Dict[str, Any]]] = []
    landmarks: Optional[List[Dict[str, str]]] = []
    images: Optional[List[Dict[str, str]]] = []
    main_content: Optional[str] = ""


class ChatRequest(BaseModel):
    message: str
    page_context: Optional[PageContext] = None
    user_profile: Optional[UserProfile] = None


class Action(BaseModel):
    action: str
    selector: Optional[str] = None
    value: Optional[str] = None
    direction: Optional[str] = None
    amount: Optional[int] = None
    text: Optional[str] = None
    styles: Optional[Dict[str, str]] = None
    description: Optional[str] = None


class ChatResponse(BaseModel):
    response_text: str
    actions: List[Action] = []


# --- Content Description & Narration models (GPT-4o-mini) ---

class ImageItem(BaseModel):
    base64: Optional[str] = None   # base64-encoded image data (preferred)
    url: Optional[str] = None      # raw src URL fallback if base64 failed
    original_alt: Optional[str] = None  # existing alt text on the page, if any


class DescribeImagesRequest(BaseModel):
    images: List[ImageItem]
    page_title: Optional[str] = ""


class ImageDescription(BaseModel):
    index: int
    description: str


class DescribeImagesResponse(BaseModel):
    descriptions: List[ImageDescription]


class PageSection(BaseModel):
    heading: str
    text: str


class NarratePageRequest(BaseModel):
    sections: List[PageSection]
    page_title: Optional[str] = ""
    page_url: Optional[str] = ""


class NarratePageResponse(BaseModel):
    narration: str


# ========== INTELLIGENT PAGE SIMPLIFICATION ==========

class SimplifyRequest(BaseModel):
    page_url: str
    page_title: str
    page_content: str  # Extracted text content
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
- If the user says something that sounds like an article title, headline, or link text, they want to CLICK it
- If the user says "click X" or "press X" or "open X" or "go to X", find the best matching element and click it
- If the user says "highlight X" or "show me X" or "find X" or "where is X", find the element and highlight it
- If the user says "type X into Y" or "enter X in Y", type X into input Y
- If the user says "scroll down/up" or navigation commands, use scroll
- Match elements by fuzzy text similarity — the user won't say exact text
- If no element matches at all, set action to "none" and explain what went wrong
- Prefer partial matches over no match. E.g. "exercising in cold" should match "Is exercising in the cold good for you?"

Conversation context rules:
- Use the conversation history to resolve references like "the first one", "that article", "no the other one", "do that again", "go back"
- If the user says "go back" after clicking a link, they want to navigate back
- If the user says "the first article" or "the second one", resolve the reference using the elements list and conversation context

Suggestion rules — always include a short, helpful follow-up suggestion:
- After clicking a link/article: "Say 'read page' to hear it aloud, or 'go back' to return"
- After scrolling: "Keep scrolling, or say an article title to open it"
- After highlighting an element: "Say 'click' to activate it, or keep browsing"
- After typing into a field: "Say 'click' on a submit button, or keep typing"
- If no action was taken: "Try saying an article title, or say 'help' for options"
"""


class PageElement(BaseModel):
    index: int
    tag: str           # "a", "button", "input", etc.
    text: str          # visible text or label
    type: Optional[str] = None  # input type, if applicable
    region: Optional[str] = "other"  # page region: nav, main, article, footer, etc.


class InterpretCommandRequest(BaseModel):
    command: str
    elements: List[PageElement]
    page_title: Optional[str] = ""
    page_url: Optional[str] = ""
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


@app.post("/api/chat", response_model=ChatResponse)
async def chat(request: ChatRequest):
    """
    Process user message with page context and return AI response with actions.

    This endpoint receives:
    - message: User's text or voice command
    - page_context: Structured data about the current webpage
    - user_profile: User's accessibility preferences

    Returns:
    - response_text: Friendly text response to the user
    - actions: List of actions to execute on the page
    """

    # TODO: Integrate Claude API here
    # For now, return a placeholder response

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        # Return demo response if no API key
        return ChatResponse(
            response_text=f"I received your message: '{request.message}'. API key not configured - running in demo mode.",
            actions=[]
        )

    # TODO: Implement Claude API call
    # Example integration:
    # from anthropic import Anthropic
    # client = Anthropic(api_key=api_key)
    # response = client.messages.create(
    #     model="claude-sonnet-4-20250514",
    #     max_tokens=1024,
    #     system=SYSTEM_PROMPT,
    #     messages=[{"role": "user", "content": build_prompt(request)}]
    # )

    return ChatResponse(
        response_text=f"I received your message: '{request.message}'. Full AI integration coming soon!",
        actions=[]
    )


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
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured in .env")

    client = OpenAI(api_key=api_key)
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
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured in .env")

    client = OpenAI(api_key=api_key)

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


# ========== AI COMMAND INTERPRETER ENDPOINT ==========

@app.post("/api/interpret-command", response_model=InterpretCommandResponse)
async def interpret_command(request: InterpretCommandRequest):
    """
    Use GPT-4o-mini to interpret a natural-language voice command
    and map it to a page action (click, highlight, type, scroll).
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        return InterpretCommandResponse(
            action="none", explanation="AI not configured (no OPENAI_API_KEY)."
        )

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
        client = OpenAI(api_key=api_key)
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": INTERPRET_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt}
            ],
            max_tokens=200,
            temperature=0.1
        )
        response_text = response.choices[0].message.content.strip()

        # Handle markdown-wrapped JSON
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        data = json.loads(response_text)
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

    openai_key = os.getenv("OPENAI_API_KEY")
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")

    # Check if we have any AI provider available
    has_openai = openai_key and OPENAI_AVAILABLE
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
            client = openai.OpenAI(api_key=openai_key)
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
        # Handle case where response might have markdown code blocks
        if "```json" in response_text:
            response_text = response_text.split("```json")[1].split("```")[0].strip()
        elif "```" in response_text:
            response_text = response_text.split("```")[1].split("```")[0].strip()

        data = json.loads(response_text)

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
    text: str
    voice: Optional[str] = "nova"  # nova, alloy, echo, fable, onyx, shimmer


@app.post("/api/tts")
async def text_to_speech(request: TTSRequest):
    """
    Convert text to natural-sounding speech using OpenAI TTS.
    Returns audio/mpeg binary data.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    try:
        client = OpenAI(api_key=api_key)
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
