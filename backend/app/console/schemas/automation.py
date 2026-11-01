"""Website SDK discovery and resource link contracts."""

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class AutomationCapabilities(BaseModel):
    version: int = 1
    user_id: str
    owner_user_id: str
    scopes: list[str]
    operations: dict[str, Any]
    schemas: dict[str, Any]


class AutomationOpenIn(BaseModel):
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


class AutomationOpenOut(AutomationOpenIn):
    path: str
