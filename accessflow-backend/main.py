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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
