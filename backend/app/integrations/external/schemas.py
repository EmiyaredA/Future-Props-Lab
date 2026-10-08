from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

from .contracts import ExternalError, document_target


class ExternalConnectionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Literal["feishu"] = "feishu"
    name: str = Field(min_length=1, max_length=120)
    app_id: str = Field(min_length=1, max_length=120, pattern=r"^[a-zA-Z0-9_-]+$")
    app_secret: str = Field(default="", max_length=8192)
    enabled: bool = True

    @field_validator("name", "app_id")
    @classmethod
    def strip_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("不能为空")
        return value.strip()


class ExternalConnectionUpdate(ExternalConnectionInput):
    expected_revision: int = Field(ge=0)


class ExternalConnectionOut(BaseModel):
    id: str
    provider: Literal["feishu"]
    name: str
    app_id: str
    has_secret: bool
    enabled: bool
    status: str
    status_message: str
    last_checked_at: str | None
    revision: int


class ExternalConnectionList(BaseModel):
    items: list[ExternalConnectionOut]


class ExternalTargetInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(max_length=2048)

    @field_validator("url")
    @classmethod
    def target_url(cls, value: str) -> str:
        try:
            return document_target(value)[1]
        except ExternalError as exc:
            raise ValueError(str(exc)) from None


class ExternalTargetOut(BaseModel):
    document_id: str
    url: str
    title: str
    text: str
    fingerprint: str
    revision: int
    can_write: bool
