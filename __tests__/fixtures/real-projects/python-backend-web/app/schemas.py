"""Pydantic request/response schemas for the /items endpoints."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict


class ItemCreate(BaseModel):
    """Payload for creating an item."""

    name: str


class ItemRead(BaseModel):
    """Response shape for a persisted item."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
