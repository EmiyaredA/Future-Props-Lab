"""Exact uploaded bytes and node media kind covered by a Visual retention authority."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.asset_library.descriptions import ID
from studio.contracts.visual_workshop.visual_composition import composition_source
from studio.contracts.visual_workshop.visual_generation import generation_source

SOURCE = "/v1/visual-workshop/projects"


class VisualUpload(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["material", "image", "audio", "video"]
    filename: str = Field(min_length=1, max_length=255, pattern=r"^[^/\\\x00-\x1f]+$")
    mime_type: str = Field(max_length=255, pattern=r"^[a-z0-9.+-]+/[a-z0-9.+-]+$")
    byte_size: int = Field(ge=1, strict=True)
    content_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    composition_batch_id: str | None = Field(default=None, pattern=rf"^{ID}$")
    generation_task_id: str | None = Field(default=None, pattern=rf"^{ID}$")

    @model_validator(mode="after")
    def require_one_generated_source(self):
        if self.composition_batch_id and self.generation_task_id:
            raise ValueError("上传只能属于一个生成来源")
        return self

    def from_model_request(self, method, path):
        return bool(
            (self.composition_batch_id or self.generation_task_id)
            and generation_source(method, path)
        )

    def matches_source(self, method, path, project):
        if method != "POST":
            return False
        if self.from_model_request(method, path):
            source = generation_source(method, path)
            return bool(
                source[1] == project
                and self.kind != "material"
                and (
                    self.composition_batch_id is None
                    or (source[2] == "batches" and self.kind == "image")
                )
            )
        if self.generation_task_id is not None:
            return self.kind != "material" and path == (
                "/v1/visual-workshop/generation-tasks/"
                f"{self.generation_task_id}/retry-materialization"
            )
        if self.composition_batch_id is not None:
            return self.kind == "image" and composition_source(
                method, path, project, self.composition_batch_id
            )
        root = f"{SOURCE}/{project}"
        if self.kind == "material":
            return path == root + "/node-uploads"
        return re.fullmatch(re.escape(root) + rf"/nodes/{ID}/output-uploads", path) is not None
