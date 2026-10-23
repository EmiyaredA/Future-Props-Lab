from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .schemas import AcceptanceCriterion, AcceptanceRunOut

SchemeId = Literal["motion-transfer:api", "motion-transfer:codex", "motion-transfer:claude-code"]


class AcceptanceSchemeOut(BaseModel):
    id: SchemeId
    title: str
    kind: Literal["model_api", "code_agent"]
    version: int = 1
    available: bool
    message: str
    connection_label: str
    model_slug: str = ""
    provider_kind: str = ""
    input_description: str
    output_description: str


class NodeAcceptanceTemplateOut(BaseModel):
    id: str = "builtin:motion-transfer"
    title: str = "动作迁移"
    version: int = 1
    readonly: bool = True
    kinds: list[str] = Field(default_factory=lambda: ["video"])
    criteria: list[AcceptanceCriterion]
    schemes: list[AcceptanceSchemeOut]


class NodeAcceptanceCatalogOut(BaseModel):
    items: list[NodeAcceptanceTemplateOut]


class AcceptanceInputOut(BaseModel):
    asset_id: str
    label: str
    kind: Literal["image", "video"]
    role: Literal["character", "motion", "output"]


class NodeAcceptanceOut(BaseModel):
    node_id: str
    revision: int = 0
    scheme_id: SchemeId | None = None
    output_id: str | None = None
    output_version: int | None = None
    canvas_revision: int
    context_fingerprint: str
    input_source: str
    prompt: str = ""
    specifications: dict = Field(default_factory=dict)
    inputs: list[AcceptanceInputOut] = Field(default_factory=list)
    issues: list[str] = Field(default_factory=list)
    current_run: AcceptanceRunOut | None = None
    result_is_current: bool = False


class NodeAcceptanceSelectIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    scheme_id: SchemeId | None


class NodeAcceptanceStartIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    expected_canvas_revision: int = Field(ge=0)
    context_fingerprint: str = Field(min_length=64, max_length=64)
    output_id: str
    request_id: str = Field(min_length=1, max_length=100)
    previous_run_id: str | None = None


class AcceptanceSummaryItem(BaseModel):
    node_id: str
    title: str
    kind: str
    scheme_id: str | None = None
    output_id: str | None = None
    output_version: int | None = None
    output_asset_id: str | None = None
    final_version: int | None = None
    state: str
    issue: str = ""
    run: AcceptanceRunOut | None = None


class AcceptanceSummaryOut(BaseModel):
    items: list[AcceptanceSummaryItem]
