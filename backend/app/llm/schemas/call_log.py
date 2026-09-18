from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from pydantic import BaseModel, Field, model_validator


class CallLogOut(BaseModel):
    id: str
    call_source: str
    provider_kind: str
    model: str
    auth_kind: str | None = None
    api_key_id: str | None = None
    api_key_name: str | None = None
    api_key_prefix: str | None = None
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
    auth_kind: str | None = None
    api_key_id: str | None = None
    api_key_name: str | None = None
    api_key_prefix: str | None = None
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


CALL_SOURCE_PATTERN = (
    "^(|model_diagnostic|model_playground|model_inference|visual_workshop_assistant|"
    "visual_workshop_generation|thought_workshop_assistant|audio_annotation)$"
)
PROVIDER_KIND_PATTERN = (
    "^(|openai|anthropic|senseaudio_asr|senseaudio_asr_pro|senseaudio_realtime)$"
)
API_KEY_FILTER_PATTERN = r"^(|session|[0-9a-fA-F-]{36})$"


def log_date(value: str | None, *, end: bool = False) -> datetime | None:
    if not value:
        return None
    if len(value) == 10:
        value += "T23:59:59.999999" if end else "T00:00:00"
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo:
        parsed = parsed.astimezone(UTC)
    return parsed.replace(tzinfo=None)


class CallLogQuery(BaseModel):
    q: str = Field("", max_length=200)
    call_source: str = Field("", pattern=CALL_SOURCE_PATTERN)
    provider_kind: str = Field("", pattern=PROVIDER_KIND_PATTERN)
    model: str = Field("", max_length=160)
    api_key_id: str = Field("", pattern=API_KEY_FILTER_PATTERN)
    status: str = Field("", pattern="^(|success|error)$")
    from_: str | None = Field(None, alias="from")
    to: str | None = None
    page: int = Field(1, ge=1)
    page_size: int = Field(25, ge=1, le=100)

    @model_validator(mode="after")
    def valid_dates(self):
        start, end = log_date(self.from_), log_date(self.to, end=True)
        if start and end and start > end:
            raise ValueError("开始日期不能晚于结束日期")
        return self

    def service_filters(self):
        return dict(
            q=self.q.strip(),
            call_source=self.call_source,
            provider_kind=self.provider_kind,
            model=self.model.strip(),
            api_key_id=self.api_key_id.strip(),
            status=self.status,
            from_dt=log_date(self.from_),
            to_dt=log_date(self.to, end=True),
            page=self.page,
            page_size=self.page_size,
        )


class CrossWorkspaceLogQuery(CallLogQuery):
    workspace_ids: list[str] = Field(default_factory=list)
