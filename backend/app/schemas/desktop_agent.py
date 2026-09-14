"""Public desktop automation contracts; never expose browser credentials."""

from typing import Any, Literal

from pydantic import BaseModel, Field


class AgentPairIn(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r"^[^\x00-\x1f\x7f]+$")
    scope: Literal["studio:read", "studio:write"] = "studio:read"


class AgentPairOut(BaseModel):
    id: str
    code: str
    name: str
    scope: str
    status: str


class AgentPairStarted(AgentPairOut):
    claim_token: str


class AgentClaimIn(BaseModel):
    claim_token: str = Field(min_length=32, max_length=128)


class AgentClaimOut(BaseModel):
    status: str
    api_key: str | None = None
    key_id: str | None = None
    user_id: str | None = None
    workspace_id: str | None = None


class AgentDecisionIn(BaseModel):
    approve: bool
    code: str = Field(min_length=6, max_length=6)


class AgentCapabilities(BaseModel):
    version: int = 1
    user_id: str
    workspace_id: str
    scopes: list[str]
    operations: dict[str, Any]
    schemas: dict[str, Any]


class DesktopOpenIn(BaseModel):
    kind: Literal["visual", "galgame", "video", "presentation", "annotation", "note", "knowledge"]
    resource_id: str = Field(min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$")


class DesktopOpenOut(DesktopOpenIn):
    id: str
    status: Literal["pending", "waiting_confirmation", "opened", "cancelled", "unavailable"]


class DesktopOpenAck(BaseModel):
    status: Literal["waiting_confirmation", "opened", "cancelled", "unavailable"]


class DesktopInbox(BaseModel):
    requests: list[DesktopOpenOut]
    change_revision: int
