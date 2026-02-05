"""
AccessFlow Backend - FastAPI Server
Handles AI processing for the accessibility companion Chrome extension.
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import os
from dotenv import load_dotenv
from openai import OpenAI

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


@app.get("/")
async def root():
    return {"message": "AccessFlow API is running", "version": "1.0.0"}


@app.get("/health")
async def health_check():
    return {"status": "healthy"}


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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
