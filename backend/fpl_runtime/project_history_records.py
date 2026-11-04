"""Record shapes shared by the versioned Motion and Video project owners."""

from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .library_assets import ID

Identifier = Annotated[str, Field(pattern=f"^{ID}$")]


class HistoryRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class ProjectRecord(HistoryRecord):
    id: Identifier
    title: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime


class DocumentRecord(HistoryRecord):
    project_id: Identifier
    document: dict
    revision: int = Field(ge=0, strict=True)
    updated_at: datetime


class OperationRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    request_id: str = Field(min_length=1, max_length=64)
    base_revision: int = Field(ge=0, strict=True)
    result_revision: int = Field(ge=0, strict=True)
    operations: list[dict]
    created_at: datetime

    @model_validator(mode="after")
    def check_progress(self):
        if self.result_revision != self.base_revision + 1:
            raise ValueError("编辑操作记录必须递进一个修订")
        return self


class TaskRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    request_id: str = Field(min_length=1, max_length=64)
    status: str
    progress: int = Field(ge=0, le=100, strict=True)
    request_payload: dict
    snapshot_document: dict
    error: str | None
    cancel_requested: bool
    created_at: datetime
    updated_at: datetime
