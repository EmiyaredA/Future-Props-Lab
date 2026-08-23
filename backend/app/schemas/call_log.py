from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class CallLogOut(BaseModel):
    id: str
    call_source: str
    provider_kind: str
    model: str
    trace_id: str
    request_payload: dict[str, Any]
    response_payload: dict[str, Any]
    prompt_tokens: int | None
    completion_tokens: int | None
    total_tokens: int | None
    latency_ms: int
    status: str
    error_message: str | None
    reproduction_supported: bool
    reproduction_reason: str
    created_at: str


class CallLogListItem(BaseModel):
    id: str
    call_source: str
    provider_kind: str
    model: str
    trace_id: str
    total_tokens: int | None
    latency_ms: int
    status: str
    created_at: str


class CallLogListOut(BaseModel):
    items: list[CallLogListItem]
    total: int
    page: int
    page_size: int


class CallLogStatsOut(BaseModel):
    calls_today: int
    total_tokens_today: int
    avg_latency_ms_today: int
    errors_today: int


class BatchDeleteIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=200)
