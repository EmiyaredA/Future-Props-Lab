"""A Motion export binds every frame to a frozen document and original file revisions."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .motion_assets import ID, SOURCE
from .motion_preview import DIGEST, FrameScope
from .timed_peer import TimedPeer, load_peer_key

PREFIX = "/_internal/v1/motion-exports"
PURPOSE = "motion.exports.submit"


class RenderWindow(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    formats: tuple[Literal["mp4", "mov4444", "png-sequence"], ...] = Field(
        min_length=1, max_length=3
    )
    start: int = Field(ge=0, le=3600, strict=True)
    end: int = Field(gt=0, le=3600, strict=True)

    @model_validator(mode="after")
    def validate_window(self):
        if self.end <= self.start or len(set(self.formats)) != len(self.formats):
            raise ValueError("导出范围或格式无效")
        return self


class RenderRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    window: RenderWindow
    document: dict
    scope: FrameScope


def render_target(method, path):
    if method != "POST":
        return None
    return re.fullmatch(rf"{PREFIX}/({ID})/([a-f0-9]{{32}})/({DIGEST})/({DIGEST})", path)


def render_grant(grant):
    if (grant.caller, grant.purpose, grant.target_service, grant.source_method) != (
        "motion",
        PURPOSE,
        "rendering",
        "POST",
    ):
        return False
    match = render_target(grant.target_method, grant.target_path)
    return bool(match and grant.source_path == f"{SOURCE}/projects/{match[1]}/exports")


def export_media(document, start, end):
    return {
        layer.asset_id
        for layer in document.layers
        if layer.asset_id and layer.visible and layer.start_frame < end and layer.end_frame > start
    }


class RenderStatus(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["queued", "running", "completed", "failed", "cancelled"]
    progress: int = Field(ge=0, le=100)
    outputs: dict[str, str]
    error: str | None


class ExportPeer(TimedPeer):
    """Authorize Motion controls separately from the original render grant."""

    OWNER = "X-Fpl-Export-Owner"
    TIME = "X-Fpl-Export-Time"
    PROOF = "X-Fpl-Export-Proof"

    def __init__(self, secret):
        super().__init__(secret, domain=b"fpl-motion-render-control-v1")


def load_export_key(path, *, identity_credential, archive_key=None):
    return load_peer_key(path, excluded=(identity_credential, archive_key))
