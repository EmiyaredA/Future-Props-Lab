"""Bind publication authority to a task created from a live Visual approval."""

from pydantic import BaseModel, ConfigDict, Field

from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.motion_compositor.motion_preview import DIGEST

PUBLISH = "/_internal/v1/asset-retention/visual-generation/publish"


class ApprovedGenerationPublication(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    plan_sha256: str = Field(pattern=rf"^{DIGEST}$")
    change: PrepareReferenceChange
