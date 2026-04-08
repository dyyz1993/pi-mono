"""Chat API routes."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class ChatMessage(BaseModel):
    """Chat message model."""
    role: str
    content: str


class ChatRequest(BaseModel):
    """Chat request model."""
    messages: list[ChatMessage]


class ChatResponse(BaseModel):
    """Chat response model."""
    response: str
    status: str = "success"


@router.post("/message", response_model=ChatResponse)
async def send_message(request: ChatRequest) -> ChatResponse:
    """
    Send a chat message and receive a response.
    
    This is a placeholder implementation. In a real application,
    this would integrate with an AI model or other backend service.
    """
    if not request.messages:
        raise HTTPException(status_code=400, detail="No messages provided")
    
    # Placeholder response
    last_message = request.messages[-1]
    return ChatResponse(
        response=f"You said: {last_message.content}. This is a placeholder response.",
    )
