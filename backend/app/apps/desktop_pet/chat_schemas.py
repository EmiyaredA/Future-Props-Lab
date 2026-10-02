"""Public shapes for a user's desktop pet conversation."""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from app.capabilities.media_rendering.live2d.document import ValueModel


class PetChatMessageOut(ValueModel):
    id: str
    position: int
    role: Literal["user", "assistant"]
    content: str
    status: Literal["completed", "pending", "interrupted"]
    created_at: str = Field(alias="createdAt")


class PetChatOut(ValueModel):
    revision: int
    model_id: str | None = Field(alias="modelId")
    proactive_lines_enabled: bool = Field(alias="proactiveLinesEnabled")
    active: bool
    messages: list[PetChatMessageOut]
    next_before: int | None = Field(alias="nextBefore")


class PetChatMessagesOut(ValueModel):
    items: list[PetChatMessageOut]
    next_before: int | None = Field(alias="nextBefore")


class PetChatSettingsIn(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    model_id: str | None = Field(alias="modelId")
    proactive_lines_enabled: bool = Field(alias="proactiveLinesEnabled")


class PetChatClearIn(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)


class PetChatSendIn(ValueModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=1, max_length=64)
    content: str = Field(min_length=1, max_length=2000)


class PetChatStreamEvent(ValueModel):
    type: Literal["start", "delta", "done", "error"]
    text: str = ""
    revision: int | None = None
    message: PetChatMessageOut | None = None
    detail: str | None = None
