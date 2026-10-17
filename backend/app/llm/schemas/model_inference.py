from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.llm.task_execution import TaskExecutionInfo


class InferenceMessage(BaseModel):
    model_config = ConfigDict(extra="forbid")
    role: Literal["user", "assistant"]
    text: str = Field(max_length=100000)
    asset_ids: list[str] = Field(default_factory=list, max_length=5)


class InferenceTextIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    model_id: str
    messages: list[InferenceMessage] = Field(min_length=1, max_length=100)
    system_prompt: str = Field(default="", max_length=100000)
    temperature: float = Field(default=0.7, ge=0, le=2)
    max_tokens: int = Field(default=1024, ge=1, le=128000)


class InferenceTextOut(BaseModel):
    text: str
    log_id: str
    finish_reason: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    total_tokens: int | None = None


class InferenceTextEvent(BaseModel):
    type: Literal["start", "delta", "done", "error"]
    text: str = ""
    log_id: str | None = None
    result: InferenceTextOut | None = None
    message: str | None = None


class InferenceTaskIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: str = Field(min_length=1, max_length=64)
    model_id: str
    kind: Literal["image", "video", "music", "sound_effect", "transcription"]
    parameters: dict = Field(default_factory=dict)
    asset_ids: list[str] = Field(default_factory=list, max_length=15)


class InferenceTaskOut(BaseModel):
    id: str
    model_id: str | None
    model_slug: str
    kind: Literal["image", "video", "music", "sound_effect", "transcription"]
    status: Literal[
        "queued", "submitting", "pending", "processing", "running", "completed", "failed"
    ]
    progress: int
    execution_info: TaskExecutionInfo | None = None
    request_payload: dict
    result: dict
    result_filename: str
    result_mime_type: str
    result_byte_size: int
    result_available: bool
    can_retry_materialization: bool
    error_message: str | None
    log_id: str | None
    revision: int
    created_at: datetime
    updated_at: datetime


class InferenceTasksOut(BaseModel):
    items: list[InferenceTaskOut]
    total: int


class InferenceModelOut(BaseModel):
    id: str
    label: str
    modalities: list[str]
    parameters: dict


class InferenceOptionsOut(BaseModel):
    items: list[InferenceModelOut]


class InferenceAssetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    filename: str
    mime_type: str
    media_kind: str
    byte_size: int


class InferenceAssetImportIn(BaseModel):
    asset_id: str


class InferenceRevisionIn(BaseModel):
    expected_revision: int = Field(ge=0)
