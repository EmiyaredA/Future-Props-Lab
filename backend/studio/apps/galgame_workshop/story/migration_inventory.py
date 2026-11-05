from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Literal

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from studio.apps.galgame_workshop.schemas import (
    GalgameStoryMigrationRunOut,
    GalgameStoryMigrationStatusOut,
    GalgameStoryProject,
)
from studio.apps.galgame_workshop.schemas.story_legacy import LEGACY_STORY_VERSIONS
from studio.apps.galgame_workshop.storage.models import GalgameStoryDocument, GalgameWorkshopProject
from studio.apps.galgame_workshop.story.document_values import normalize_story_document
from studio.runtime.time import utc_now

StoryMigrationState = Literal["pending", "invalid", "current"]


@dataclass(frozen=True)
class StoryMigrationCandidate:
    row: GalgameStoryDocument
    state: StoryMigrationState
    normalized: GalgameStoryProject | None


def inspect_story_migration(
    value: object,
) -> tuple[StoryMigrationState, GalgameStoryProject | None]:
    if not isinstance(value, dict):
        return "invalid", None
    version = value.get("schemaVersion")
    if version not in {*LEGACY_STORY_VERSIONS, "1.4"}:
        return "invalid", None
    try:
        normalized = normalize_story_document(value)
    except GalgameStoryDocumentInvalidError:
        return "invalid", None
    return ("current" if version == "1.4" else "pending"), normalized


class StoryMigrationInventory:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def _candidates(self) -> list[StoryMigrationCandidate]:
        rows = list(
            (
                await self.session.execute(
                    select(GalgameStoryDocument)
                    .join(
                        GalgameWorkshopProject,
                        GalgameWorkshopProject.id == GalgameStoryDocument.project_id,
                    )
                    .where(GalgameWorkshopProject.owner_user_id == self.owner_user_id)
                    .order_by(GalgameStoryDocument.project_id)
                )
            )
            .scalars()
            .all()
        )
        return [
            StoryMigrationCandidate(row=row, state=state, normalized=normalized)
            for row in rows
            for state, normalized in [inspect_story_migration(row.document)]
        ]

    async def status(self) -> GalgameStoryMigrationStatusOut:
        candidates = await self._candidates()
        counts = {
            state: sum(candidate.state == state for candidate in candidates)
            for state in ("pending", "invalid", "current")
        }
        return GalgameStoryMigrationStatusOut(total=len(candidates), **counts)

    async def run(self, limit: int, *, verify_projection=None) -> GalgameStoryMigrationRunOut:
        candidates = await self._candidates()
        pending = [candidate for candidate in candidates if candidate.state == "pending"][:limit]
        migrated = 0
        conflicts = 0
        project_ids = select(GalgameWorkshopProject.id).where(
            GalgameWorkshopProject.owner_user_id == self.owner_user_id
        )
        if verify_projection is not None:
            await verify_projection(pending)
        for candidate in pending:
            assert candidate.normalized is not None
            result = await self.session.execute(
                update(GalgameStoryDocument)
                .where(
                    GalgameStoryDocument.project_id == candidate.row.project_id,
                    GalgameStoryDocument.project_id.in_(project_ids),
                    GalgameStoryDocument.revision == candidate.row.revision,
                )
                .values(
                    document=candidate.normalized.model_dump(mode="json", by_alias=True),
                    revision=candidate.row.revision + 1,
                    updated_at=utc_now(),
                )
            )
            if result.rowcount == 1:
                migrated += 1
            else:
                conflicts += 1
        await self.session.commit()
        status = await self.status()
        return GalgameStoryMigrationRunOut(
            migrated=migrated,
            conflicts=conflicts,
            invalid=status.invalid,
            remaining=status.pending,
            current=status.current,
            total=status.total,
        )


MAX_STORY_IMPORT_BYTES = 10 * 1024 * 1024


def decode_legacy_story(payload: bytes) -> object:
    if len(payload) > MAX_STORY_IMPORT_BYTES:
        raise GalgameStoryDocumentInvalidError("Story 导入文件不能超过 10 MB")
    try:
        return json.loads(payload.decode("utf-8-sig"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise GalgameStoryDocumentInvalidError("Story 导入文件不是有效的 UTF-8 JSON") from exc


def normalize_legacy_import(document: object) -> GalgameStoryProject:
    if not isinstance(document, dict):
        raise GalgameStoryDocumentInvalidError("导入文件必须包含一个 Story JSON 对象")
    version = document.get("schemaVersion")
    if version == "1.4":
        raise GalgameStoryDocumentInvalidError("Story 1.4 请使用主保存接口，不需要旧格式导入")
    if version not in LEGACY_STORY_VERSIONS:
        raise GalgameStoryDocumentInvalidError("仅支持导入 Story 1.0–1.3 文件")
    return normalize_story_document(document)
