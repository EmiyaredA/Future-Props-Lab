from typing import Literal

from pydantic import BaseModel, Field, model_validator

MediaKind = Literal["image", "video", "audio", "text"]
Verdict = Literal["passed", "failed", "pending", "not_applicable"]


class Specification(BaseModel):
    min_width: int | None = Field(default=None, ge=1, le=16384)
    min_height: int | None = Field(default=None, ge=1, le=16384)
    ratio: Literal["16:9", "9:16", "1:1", "4:3", "3:4"] | None = None
    min_duration: float | None = Field(default=None, ge=0, le=86400)
    max_duration: float | None = Field(default=None, gt=0, le=86400)
    require_audio: bool = False

    @model_validator(mode="after")
    def ordered_duration(self):
        if (
            self.min_duration is not None
            and self.max_duration is not None
            and self.min_duration > self.max_duration
        ):
            raise ValueError("最短时长不能超过最长时长")
        return self


class AcceptanceCriterion(BaseModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(min_length=1, max_length=120)
    requirement: str = Field(default="", max_length=3000)
    kinds: list[MediaKind] = Field(
        default_factory=lambda: ["image", "video"], min_length=1, max_length=4
    )
    method: Literal["automatic", "ai", "manual"] = "manual"
    required: bool = True
    specifications: Specification = Field(default_factory=Specification)
    reference_label: str = Field(default="", max_length=120)
    reference_asset_ids: list[str] = Field(default_factory=list, max_length=6)

    @model_validator(mode="after")
    def supported_method(self):
        if self.method != "manual" and any(kind not in {"image", "video"} for kind in self.kinds):
            raise ValueError("音频与文本首版仅支持人工检查")
        if not self.title.strip() or len(set(self.kinds)) != len(self.kinds):
            raise ValueError("条目名称不能为空，媒体类型不能重复")
        if len(set(self.reference_asset_ids)) != len(self.reference_asset_ids):
            raise ValueError("参考素材不能重复")
        return self


class AcceptanceDocument(BaseModel):
    title: str = Field(default="项目验收标准", min_length=1, max_length=120)
    node_ids: list[str] = Field(default_factory=list, max_length=1000)
    criteria: list[AcceptanceCriterion] = Field(default_factory=list, max_length=40)

    @model_validator(mode="after")
    def unique_ids(self):
        ids = [item.id for item in self.criteria]
        if len(ids) != len(set(ids)) or len(self.node_ids) != len(set(self.node_ids)):
            raise ValueError("验收条目和应用节点不能重复")
        return self


class AcceptanceTemplateOut(BaseModel):
    id: str
    title: str
    builtin: bool = False
    revision: int = 0
    document: AcceptanceDocument


class AcceptanceTemplateListOut(BaseModel):
    items: list[AcceptanceTemplateOut]


class AcceptanceTemplateWriteIn(BaseModel):
    document: AcceptanceDocument
    expected_revision: int = Field(ge=0)


class AcceptanceStandardOut(BaseModel):
    project_id: str
    revision: int = 0
    required: bool = False
    published_version: int = 0
    draft: AcceptanceDocument = Field(default_factory=AcceptanceDocument)
    published: AcceptanceDocument | None = None


class AcceptanceStandardWriteIn(BaseModel):
    expected_revision: int = Field(ge=0)
    document: AcceptanceDocument
    publish: bool = False
    required: bool = False


class AcceptanceRunCreateIn(BaseModel):
    expected_standard_version: int = Field(ge=1)
    output_ids: list[str] = Field(min_length=1, max_length=20)
    request_id: str = Field(min_length=1, max_length=100)
    model_id: str | None = None
    previous_run_id: str | None = None


class AcceptanceEvidence(BaseModel):
    id: str
    asset_id: str
    position_ms: int | None = Field(default=None, ge=0)
    source_asset_id: str


class AcceptanceResult(BaseModel):
    criterion_id: str
    verdict: Verdict = "pending"
    suggestion: Verdict | None = None
    explanation: str = ""
    evidence_ids: list[str] = Field(default_factory=list)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    region: list[float] | None = Field(default=None, min_length=4, max_length=4)
    origin: Literal["automatic", "ai", "manual"]


class AcceptanceOutputSnapshot(BaseModel):
    id: str
    kind: MediaKind
    version: int
    asset_id: str | None
    text: str | None
    title: str


class AcceptanceSnapshot(BaseModel):
    standard_version: int
    standard_title: str
    criteria: list[AcceptanceCriterion]
    output: AcceptanceOutputSnapshot
    prompt: str = ""
    coverage: str
    source_bytes: int | None = None
    metadata: dict = Field(default_factory=dict)


class AcceptanceRunOut(BaseModel):
    id: str
    node_id: str
    output_id: str
    previous_run_id: str | None
    standard_version: int
    model_id: str | None
    status: Literal["queued", "processing", "completed", "failed", "cancelled"]
    decision: Literal["pending", "passed", "failed", "historical"]
    snapshot: AcceptanceSnapshot
    results: list[AcceptanceResult]
    evidence: list[AcceptanceEvidence]
    decisions: list[dict]
    error_message: str | None
    revision: int
    created_at: str


class AcceptanceRunListOut(BaseModel):
    items: list[AcceptanceRunOut]


class AcceptanceDecisionIn(BaseModel):
    expected_revision: int = Field(ge=0)
    criterion_id: str | None = None
    verdict: Verdict = "pending"
    reason: str = Field(default="", max_length=3000)
    start_ms: int | None = Field(default=None, ge=0)
    end_ms: int | None = Field(default=None, ge=0)
    region: list[float] | None = Field(default=None, min_length=4, max_length=4)
    finalize: bool = False


class AcceptanceSampleIn(BaseModel):
    expected_revision: int = Field(ge=0)
    start_ms: int = Field(ge=0)
    end_ms: int = Field(gt=0)


class AcceptanceRepairOut(BaseModel):
    id: str
    run_id: str
    text: str
    revision: int
    prompt_version_id: str | None


class AcceptanceRepairWriteIn(BaseModel):
    expected_revision: int = Field(ge=0)
    text: str = Field(min_length=1, max_length=6000)
    apply: bool = False
    expected_canvas_revision: int | None = Field(default=None, ge=0)


class AcceptanceModelOut(BaseModel):
    id: str
    label: str
    provider_name: str


class AcceptanceModelListOut(BaseModel):
    items: list[AcceptanceModelOut]
