from __future__ import annotations

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import get_settings
from app.core.time import iso_utc, utc_now
from app.files.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import VideoEditorProject, VideoEditorTimeline, VisualAsset
from app.schemas.video_editor import (
    VideoEditorProjectCreateIn,
    VideoEditorProjectListOut,
    VideoEditorProjectOut,
    VideoEditorProjectPatchIn,
)
from app.video_editor.errors import VideoEditorNotFoundError


def project_out(row: VideoEditorProject) -> VideoEditorProjectOut:
    return VideoEditorProjectOut(
        id=row.id,
        title=row.title,
        status=row.status,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        sourceApplication=row.source_application,
        sourceProjectId=row.source_project_id,
        sourceRevision=row.source_revision,
        sourceCompilerVersion=row.source_compiler_version,
    )


def default_timeline() -> dict:
    return {
        "schemaVersion": "1.0",
        "settings": {
            "width": 1920,
            "height": 1080,
            "fps": 30,
            "backgroundColor": "#000000",
        },
        "tracks": [
            {
                "id": "visual-1",
                "kind": "visual",
                "name": "画面 1",
                "order": 0,
                "locked": False,
                "hidden": False,
                "muted": False,
                "clips": [],
            },
            {
                "id": "audio-1",
                "kind": "audio",
                "name": "音频 1",
                "order": 1,
                "locked": False,
                "hidden": False,
                "muted": False,
                "clips": [],
            },
        ],
    }


class VideoEditorProjects:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.storage = AssetStorage(get_settings())

    async def row(self, project_id: str) -> VideoEditorProject:
        row = await self.session.get(VideoEditorProject, project_id)
        if row is None:
            raise VideoEditorNotFoundError("剪辑项目不存在")
        return row

    async def list(self) -> VideoEditorProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(VideoEditorProject).order_by(VideoEditorProject.updated_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return VideoEditorProjectListOut(items=[project_out(row) for row in rows])

    async def get(self, project_id: str) -> VideoEditorProjectOut:
        return project_out(await self.row(project_id))

    async def create(self, body: VideoEditorProjectCreateIn) -> VideoEditorProjectOut:
        row = VideoEditorProject(title=body.title, status="draft")
        self.session.add(row)
        await self.session.flush()
        created_root = self.storage.ensure_project_layout("video-editor", row.id)
        try:
            self.session.add(VideoEditorTimeline(project_id=row.id, document=default_timeline()))
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            if created_root:
                self.storage.remove_project_root("video-editor", row.id)
            raise
        await self.session.refresh(row)
        return project_out(row)

    async def conflict(self, project_id: str, expected: int) -> None:
        await self.session.rollback()
        current = await self.get(project_id)
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def patch(
        self, project_id: str, body: VideoEditorProjectPatchIn
    ) -> VideoEditorProjectOut:
        await self.row(project_id)
        values: dict[str, object] = {
            "revision": body.expected_revision + 1,
            "updated_at": utc_now(),
        }
        if body.title is not None:
            values["title"] = body.title
        if body.status is not None:
            values["status"] = body.status
        result = await self.session.execute(
            update(VideoEditorProject)
            .where(
                VideoEditorProject.id == project_id,
                VideoEditorProject.revision == body.expected_revision,
            )
            .values(**values)
        )
        if result.rowcount != 1:
            await self.conflict(project_id, body.expected_revision)
        await self.session.commit()
        return await self.get(project_id)

    async def delete(self, project_id: str, expected_revision: int) -> None:
        await self.row(project_id)
        assets = (
            (
                await self.session.execute(
                    select(VisualAsset).where(VisualAsset.video_editor_project_id == project_id)
                )
            )
            .scalars()
            .all()
        )
        legacy = [
            self.storage.path_for(asset)
            for asset in assets
            if asset.storage_version < TARGET_STORAGE_VERSION
        ]
        staged = self.storage.stage_project_root("video-editor", project_id)
        try:
            result = await self.session.execute(
                delete(VideoEditorProject).where(
                    VideoEditorProject.id == project_id,
                    VideoEditorProject.revision == expected_revision,
                )
            )
            if result.rowcount != 1:
                await self.conflict(project_id, expected_revision)
            await self.session.commit()
        except Exception:
            self.storage.restore_staged_root(staged)
            raise
        for path in legacy:
            path.unlink(missing_ok=True)
        self.storage.purge_staged_root(staged)
