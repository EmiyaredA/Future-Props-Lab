"""Narrow, read-only character snapshot handoff for the desktop pet app."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.live2d_workshop.projects import (
    Live2DInvalid,
    Live2DNotFound,
    Live2DProjectsStore,
    decode_png,
)
from app.capabilities.media_rendering.live2d.document import CharacterDocument


class CharacterSourceMissing(Exception):
    pass


decode_character_png = decode_png


@dataclass(frozen=True)
class CharacterSnapshot:
    project_id: str
    revision: int
    title: str
    document: CharacterDocument
    assets: dict[str, Path]


async def snapshot_character(
    session: AsyncSession,
    owner_user_id: str,
    project_id: str,
    *,
    expected_revision: int | None = None,
) -> CharacterSnapshot:
    store = Live2DProjectsStore(session, owner_user_id)
    try:
        row = await store.row(project_id)
    except Live2DNotFound as exc:
        raise CharacterSourceMissing("来源角色项目不存在") from exc
    if expected_revision is not None and row.revision != expected_revision:
        raise Live2DInvalid("角色工程已更新，请重新选择当前版本")
    document = CharacterDocument.model_validate(row.document)
    if not document.parts:
        raise Live2DInvalid("角色工程没有可用部件")
    paths = await store.paths(project_id)
    used = {part.asset_id for part in document.parts}
    if any(asset_id not in paths or not paths[asset_id].is_file() for asset_id in used):
        raise Live2DInvalid("角色工程素材不完整")
    return CharacterSnapshot(
        project_id=project_id,
        revision=row.revision,
        title=row.title,
        document=document,
        assets={asset_id: paths[asset_id] for asset_id in used},
    )
