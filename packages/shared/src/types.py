"""Shared type definitions."""

from pydantic import BaseModel


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
