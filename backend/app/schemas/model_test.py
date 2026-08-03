from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

MessageStatus = Literal["pending", "completed", "error", "cancelled", "superseded"]


class ModelTestMessageOut(BaseModel):
    id: str
    turn_id: str
    role: Literal["user", "assistant"]
    content: str
    model_slug: str
    status: MessageStatus
    error_message: str | None
    created_at: str


class ModelTestConversationSummaryOut(BaseModel):
    id: str
    title: str
    model_id: str | None
    model_slug: str
    revision: int
    created_at: str
    updated_at: str


class ModelTestConversationOut(ModelTestConversationSummaryOut):
    system_prompt: str
    temperature: float
    max_tokens: int
    messages: list[ModelTestMessageOut]


class ModelTestConversationListOut(BaseModel):
    items: list[ModelTestConversationSummaryOut]


class ModelTestConversationCreateIn(BaseModel):
    model_id: str | None = None


class ModelTestConversationPatchIn(BaseModel):
    expected_revision: int = Field(ge=0)
    title: str | None = Field(default=None, min_length=1, max_length=120)
    model_id: str | None = None
    system_prompt: str | None = Field(default=None, max_length=20000)
    temperature: float | None = Field(default=None, ge=0, le=2)
    max_tokens: int | None = Field(default=None, ge=1, le=8192)

    @model_validator(mode="after")
    def has_change(self) -> ModelTestConversationPatchIn:
        if not any(
            value is not None
            for value in (
                self.title,
                self.model_id,
                self.system_prompt,
                self.temperature,
                self.max_tokens,
            )
        ):
            raise ValueError("至少需要提供一个修改字段")
        return self


class ModelTestDeleteIn(BaseModel):
    expected_revision: int = Field(ge=0)


class ModelTestSendIn(BaseModel):
    expected_revision: int = Field(ge=0)
    content: str = Field(min_length=1, max_length=100000)


class ModelTestRegenerateIn(BaseModel):
    expected_revision: int = Field(ge=0)
