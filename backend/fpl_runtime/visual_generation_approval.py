"""Bind publication authority to a task created from a live Visual approval."""

from typing import Literal

from pydantic import UUID4, BaseModel, ConfigDict, Field

from .asset_references import PrepareReferenceChange
from .library_assets import ID
from .motion_preview import DIGEST

ADMIT = "/_internal/v1/asset-retention/visual-generation/admit"
PUBLISH = "/_internal/v1/asset-retention/visual-generation/publish"


class GenerationApproval(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    owner_id: str = Field(pattern=rf"^{ID}$")
    project_id: str = Field(pattern=rf"^{ID}$")
    task_id: UUID4
    plan_sha256: str = Field(pattern=rf"^{DIGEST}$")
    source_path: str = Field(min_length=1, max_length=1024)
    kind: Literal["image", "audio", "video"]


class ApprovedGenerationPublication(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    plan_sha256: str = Field(pattern=rf"^{DIGEST}$")
    change: PrepareReferenceChange
