from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class PublicAssetOut(BaseModel):
    id: str
    display_name: str
    media_kind: str
    mime_type: str
    byte_size: int
    preview_url: str


class PublicVisualProjectOut(BaseModel):
    id: str
    title: str
    kind: str
    status: str
    updated_at: datetime
    assets: list[PublicAssetOut] = []


class PublicGalgameProjectOut(BaseModel):
    id: str
    title: str
    status: str
    updated_at: datetime
    assets: list[PublicAssetOut] = []


class PublicWorkspaceProjectionOut(BaseModel):
    workspace_id: str
    workspace_name: str
    visual_projects: list[PublicVisualProjectOut]
    galgame_projects: list[PublicGalgameProjectOut]


class PublicGalgameStoryOut(BaseModel):
    project_id: str
    revision: int
    document: dict
