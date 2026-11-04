"""Exact uploaded bytes and node media kind covered by a Visual retention authority."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .library_assets import ID

SOURCE = "/v1/visual-workshop/projects"


class VisualUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["material", "image", "audio", "video"]
    filename: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")
    mime_type: str = Field(max_length=255, pattern=r"^[a-z0-9.+-]+/[a-z0-9.+-]+$")
    byte_size: int = Field(ge=1, strict=True)
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    def matches_source(self, method, path, project):
        if method != "POST":
            return False
        root = f"{SOURCE}/{project}"
        if self.kind == "material":
            return path == root + "/node-uploads"
        return re.fullmatch(re.escape(root) + rf"/nodes/{ID}/output-uploads", path) is not None
