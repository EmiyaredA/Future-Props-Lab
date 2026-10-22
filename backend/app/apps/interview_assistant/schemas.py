from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictDocument(BaseModel):
    model_config = ConfigDict(extra="forbid")


class InputReference(StrictDocument):
    file_id: str
    location: str
    excerpt: str


class Requirement(StrictDocument):
    id: str
    capability: str
    importance: Literal["core", "supporting"]
    evidence: list[InputReference]


class Experience(StrictDocument):
    id: str
    title: str
    summary: str
    evidence: list[InputReference]
    uncertainties: list[str]


class PreparationSource(StrictDocument):
    id: str
    url: str
    title: str
    retrieved_at: str
    published_at: str | None
    version: str | None
    excerpt: str
    supports: list[str]


class KnowledgeTopic(StrictDocument):
    id: str
    title: str
    summary: str
    relevance: str
    version: str | None
    source_ids: list[str]
    key_points: list[str]


class BlueprintQuestion(StrictDocument):
    id: str
    category: str
    question: str
    objective: str
    requirement_ids: list[str]
    experience_ids: list[str]
    source_ids: list[str]
    answer_points: list[str]
    follow_ups: list[str]


class RubricDimension(StrictDocument):
    dimension: str
    question_ids: list[str]
    answer_points: list[str]
    common_gaps: list[str]


class PreparationBundle(StrictDocument):
    schema_version: Literal[1]
    task_id: str
    input_hash: str
    material_summary: str
    requirements: list[Requirement]
    experiences: list[Experience]
    topics: list[KnowledgeTopic]
    sources: list[PreparationSource]
    questions: list[BlueprintQuestion]
    first_round: list[str]
    rubric: list[RubricDimension]
    limitations: list[str]
    material_complete: bool


class InterviewCreateIn(StrictDocument):
    request_id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=120)


class InterviewPrepareIn(StrictDocument):
    request_id: str = Field(min_length=1, max_length=100)
    expected_revision: int = Field(ge=0)
    role: str = Field(min_length=1, max_length=120)
    jd: str = Field(min_length=1, max_length=20_000)
    resume: str = Field(default="", max_length=30_000)
    material_id: str | None = None
    duration: Literal["15", "30", "45", "60"] = "30"

    @field_validator("role", "jd")
    @classmethod
    def not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("内容不能为空")
        return value.strip()


class InterviewRevisionIn(StrictDocument):
    expected_revision: int = Field(ge=0)


class InterviewMaterialOut(BaseModel):
    id: str
    filename: str
    sha256: str
    size: int
    created_at: datetime


class InterviewMaterialSnapshot(BaseModel):
    id: str
    filename: str
    sha256: str


class InterviewInputSnapshot(BaseModel):
    role: str
    jd: str
    resume: str
    duration: Literal["15", "30", "45", "60"]
    material: InterviewMaterialSnapshot | None


TaskStatus = Literal[
    "queued",
    "running",
    "validating",
    "succeeded",
    "needs_input",
    "failed",
    "cancelled",
    "interrupted",
]


class PreparationEvent(BaseModel):
    sequence: int
    kind: str
    message: str
    at: str
    urls: list[str] = Field(default_factory=list)


class InterviewTaskOut(BaseModel):
    id: str
    room_id: str
    input_hash: str
    input_version: int
    snapshot: InterviewInputSnapshot
    status: TaskStatus
    revision: int
    events: list[PreparationEvent]
    result: PreparationBundle | None
    message: str
    created_at: datetime
    updated_at: datetime


class InterviewRoomOut(BaseModel):
    id: str
    title: str
    revision: int
    input_version: int
    active_task_id: str | None
    active_bundle_id: str | None
    materials: list[InterviewMaterialOut]
    tasks: list[InterviewTaskOut]
    created_at: datetime
    updated_at: datetime


class InterviewRoomSummary(BaseModel):
    id: str
    title: str
    revision: int
    input_version: int
    active_task_id: str | None
    active_bundle_id: str | None
    created_at: datetime
    updated_at: datetime


class InterviewRoomList(BaseModel):
    items: list[InterviewRoomSummary]


class InterviewTaskProgress(BaseModel):
    id: str
    status: TaskStatus
    revision: int
    events: list[PreparationEvent]
    message: str


class InterviewExecutorOut(BaseModel):
    available: bool
    code: str
    message: str
    version: str
