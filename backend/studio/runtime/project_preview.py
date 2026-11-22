"""Bounded, read-only project-card projections; selection belongs to each application."""

import hashlib
import json
from typing import Literal
from urllib.parse import quote

from pydantic import BaseModel, Field


class PreviewCell(BaseModel):
    text: str = Field(max_length=120)
    color: str | None = None
    background: str | None = None
    bold: bool = False


class ProjectPreview(BaseModel):
    kind: Literal["image", "text", "waveform", "table", "scene", "empty"]
    source_revision: int | None = None
    source_id: str | None = None
    source_time: int = 0
    version: str
    urls: list[str] = Field(default_factory=list, max_length=4)
    label: str = Field(default="", max_length=160)
    text: str = Field(default="", max_length=400)
    peaks: list[float] = Field(default_factory=list, max_length=96)
    cells: list[list[PreviewCell]] = Field(default_factory=list, max_length=6)


def preview_version(*values) -> str:
    return hashlib.sha256(json.dumps(values, sort_keys=True, default=str).encode()).hexdigest()[:24]


def thumbnail_url(asset_id: str) -> str:
    return f"/v1/files/{quote(asset_id, safe='')}/thumbnail?size=640"
