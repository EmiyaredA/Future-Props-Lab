"""Public desktop automation contracts; never expose browser credentials."""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


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
    expected_workspace_id: str = Field(min_length=1, max_length=128)


class AgentCapabilities(BaseModel):
    version: int = 1
    user_id: str
    workspace_id: str
    scopes: list[str]
    operations: dict[str, Any]
    schemas: dict[str, Any]


class DesktopOpenIn(BaseModel):
    kind: Literal[
        "visual",
        "galgame",
        "video",
        "presentation",
        "annotation",
        "director",
        "note",
        "knowledge",
        "skill",
        "tool-api",
        "mcp",
    ]
    resource_id: str | None = Field(
        default=None, min_length=1, max_length=128, pattern=r"^[a-zA-Z0-9_-]+$"
    )
    view: (
        Literal["list", "details", "upload", "versions", "tags", "edit", "validate", "tools"] | None
    ) = None

    @model_validator(mode="after")
    def valid_target(self):
        views = {
            "skill": {"list", "details", "upload", "versions", "tags"},
            "tool-api": {"list", "edit", "validate"},
            "mcp": {"list", "edit", "tools"},
        }
        if self.kind not in views:
            if not self.resource_id or self.view is not None:
                raise ValueError("作品目标必须提供 resource_id，且不接受 view")
            return self
        if self.view is None:
            self.view = (
                ("details" if self.kind == "skill" else "edit") if self.resource_id else "list"
            )
        if self.view not in views[self.kind]:
            raise ValueError("此集成类型不支持指定视图")
        if self.view in {"list", "upload"} and self.resource_id:
            raise ValueError("列表或上传视图不接受 resource_id")
        if (
            self.view in {"details", "versions", "tags", "validate", "tools"}
            and not self.resource_id
        ):
            raise ValueError("此视图必须提供 resource_id")
        return self


class DesktopOpenOut(DesktopOpenIn):
    id: str
    status: Literal["pending", "waiting_confirmation", "opened", "cancelled", "unavailable"]


class DesktopOpenAck(BaseModel):
    status: Literal["waiting_confirmation", "opened", "cancelled", "unavailable"]


class DesktopInbox(BaseModel):
    requests: list[DesktopOpenOut]
    change_revision: int
    integration_revisions: dict[str, int] = Field(default_factory=dict)
    content_change_revision: int = 0
