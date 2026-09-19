"""Director-desk project document. The editor is the scene writer; this only stores that JSON."""

import re
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

MAX_TEXT = 16_384
FILE_KEY = re.compile(r"^[a-f0-9]{64}$")


class DirectorModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _reject_embedded_binary(value: object) -> None:
    if isinstance(value, str):
        if len(value) > MAX_TEXT or value.startswith("data:"):
            raise ValueError("工程文档不能嵌入模型、贴图或视频")
        return
    if isinstance(value, list):
        for item in value:
            _reject_embedded_binary(item)
        return
    if isinstance(value, dict):
        file_key = value.get("file")
        if file_key is not None and (
            not isinstance(file_key, str) or FILE_KEY.fullmatch(file_key) is None
        ):
            raise ValueError("文件引用无效")
        data = value.get("data")
        if isinstance(data, str) and ("path" in value or data.startswith("data:")):
            raise ValueError("工程文档不能嵌入模型、贴图或视频")
        for item in value.values():
            _reject_embedded_binary(item)


class DirectorDocument(DirectorModel):
    format: Literal["director-desk"] = "director-desk"
    version: Literal[3] = 3
    name: str = Field(min_length=1, max_length=120)
    activeSceneId: str | None = Field(default=None, max_length=200)
    resources: list[dict[str, Any]] = Field(default_factory=list)
    media: list[dict[str, Any]] | None = None
    scenes: list[dict[str, Any]] = Field(default_factory=list)

    @field_validator("resources", "media", "scenes")
    @classmethod
    def reject_embedded_binary(cls, value: object) -> object:
        _reject_embedded_binary(value)
        return value

    @model_validator(mode="after")
    def require_active_scene(self) -> "DirectorDocument":
        if self.scenes and not self.activeSceneId:
            raise ValueError("当前戏段不存在")
        return self


class DirectorProjectCreate(DirectorModel):
    title: str = Field(default="未命名预演", min_length=1, max_length=120)


class DirectorProjectPatch(DirectorModel):
    title: str = Field(min_length=1, max_length=120)
    expected_revision: int = Field(ge=0)
    document: DirectorDocument | None = None


class DirectorProjectOut(DirectorModel):
    id: str
    title: str
    document: DirectorDocument
    revision: int
    created_at: datetime
    updated_at: datetime


class DirectorProjectSummary(DirectorModel):
    id: str
    title: str
    revision: int
    updated_at: datetime


class DirectorProjectList(DirectorModel):
    items: list[DirectorProjectSummary]
    total: int


class DirectorFileOut(DirectorModel):
    key: str = Field(pattern=r"^[a-f0-9]{64}$")
    size: int = Field(ge=1)


class DirectorMotionWrite(DirectorModel):
    motion: dict[str, Any]
    resource: dict[str, Any]

    @model_validator(mode="after")
    def reject_embedded_binary(self) -> "DirectorMotionWrite":
        _reject_embedded_binary({"motion": self.motion, "resource": self.resource})
        return self


class DirectorMotionOut(DirectorModel):
    motion: dict[str, Any]
    resource: dict[str, Any]


class DirectorMotionList(DirectorModel):
    items: list[dict[str, Any]]


class DirectorToolCall(DirectorModel):
    name: str = Field(min_length=1, max_length=64)
    arguments: dict[str, Any] = Field(default_factory=dict)
    request_id: str = Field(min_length=1, max_length=200)


class DirectorToolOut(DirectorModel):
    result: Any


class DirectorAgentSessionOut(DirectorModel):
    session_id: str


class DirectorPendingCall(DirectorModel):
    id: str
    name: str
    arguments: dict[str, Any]
    request_id: str


class DirectorAgentPollOut(DirectorModel):
    call: DirectorPendingCall | None = None


class DirectorAgentCallComplete(DirectorModel):
    session_id: str = Field(min_length=16, max_length=64)
    result: Any = None
    error: str | None = Field(default=None, max_length=4000)
