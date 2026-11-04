"""A Motion export binds every frame to a frozen document and original file revisions."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .motion_assets import ID, SOURCE
from .motion_preview import DIGEST, FrameScope

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


class ExportPeer:
    """Authorize Motion-only queue controls independently of delegated Assets access."""

    OWNER = "X-Fpl-Export-Owner"
    TIME = "X-Fpl-Export-Time"
    PROOF = "X-Fpl-Export-Proof"

    def __init__(self, secret):
        if not isinstance(secret, str) or not secret.isascii() or len(secret) < 32:
            raise ValueError("特效导出对等凭据无效")
        self.key = secret.encode("ascii")

    def _digest(self, method, path, owner, timestamp):
        import hmac
        import json

        message = json.dumps([method, path, owner, timestamp], separators=(",", ":")).encode()
        return hmac.digest(self.key, b"fpl-motion-render-control-v1\0" + message, "sha256").hex()

    def headers(self, method, path, owner, *, now=None):
        import time

        timestamp = str(int(time.time()) if now is None else now)
        return {
            self.OWNER: owner,
            self.TIME: timestamp,
            self.PROOF: self._digest(method, path, owner, timestamp),
        }

    def owner(self, method, path, headers, *, now=None):
        import hmac
        import time

        owner = headers.get(self.OWNER, "")
        timestamp = headers.get(self.TIME, "")
        proof = headers.get(self.PROOF, "")
        current = int(time.time()) if now is None else now
        if (
            re.fullmatch(ID, owner)
            and re.fullmatch(r"[0-9]{1,12}", timestamp)
            and abs(current - int(timestamp)) <= 30
            and re.fullmatch(DIGEST, proof)
            and hmac.compare_digest(proof, self._digest(method, path, owner, timestamp))
        ):
            return owner
        raise ValueError("特效导出控制签名无效")


def load_export_key(path, *, identity_credential, archive_key=None):
    if path.is_symlink():
        raise ValueError("特效导出对等凭据必须为受保护的普通文件")
    if not path.exists():
        return None
    if not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError("特效导出对等凭据必须为受保护的普通文件")
    secret = path.read_text().strip()
    if secret in (identity_credential, archive_key):
        raise ValueError("特效导出对等凭据必须独立")
    return secret
