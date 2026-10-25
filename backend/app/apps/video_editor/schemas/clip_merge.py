from typing import Literal

from pydantic import BaseModel, Field, field_validator


class VideoEditorClipMergeCreateIn(BaseModel):
    expected_revision: int = Field(alias="expectedRevision", ge=0)
    request_id: str = Field(alias="requestId", min_length=8, max_length=64)
    clip_ids: list[str] = Field(alias="clipIds", min_length=2, max_length=100)
    name: str = Field(min_length=1, max_length=255)

    @field_validator("clip_ids")
    @classmethod
    def unique_ids(cls, value: list[str]) -> list[str]:
        if len(set(value)) != len(value) or any(not item or len(item) > 64 for item in value):
            raise ValueError("片段 ID 必须有效且不得重复")
        return value

    @field_validator("name")
    @classmethod
    def clean_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("合并名称不能为空")
        return value.strip()


class ClipMergeOperation(BaseModel):
    type: Literal["applyClipMerge", "undoClipMerge"]
    task_id: str = Field(alias="taskId", min_length=1, max_length=64)
    new_clip_id: str = Field(alias="newClipId", min_length=1, max_length=64)
