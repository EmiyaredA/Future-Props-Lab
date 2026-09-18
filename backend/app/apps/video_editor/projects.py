from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.errors import VideoEditorNotFoundError
from app.apps.video_editor.models import VideoEditorProject, VideoEditorTimeline
from app.apps.video_editor.schemas import (
    VideoEditorProjectCreateIn,
    VideoEditorProjectListOut,
    VideoEditorProjectOut,
    VideoEditorProjectPatchIn,
)
from app.capabilities.asset_store.project_transactions import (
    creating_project_layout,
    deleting_project_layout,
)
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.models import VisualAsset
from app.runtime.config import get_settings
from app.runtime.project_records import (
    delete_revisioned_project,
    load_workspace_project,
    patch_revisioned_project,
)
from app.runtime.time import iso_utc, utc_now


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
            "videoFitPolicyVersion": 1,
        },
        "assetOrganization": {"folders": [], "rootAssetIds": []},
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
                "id": "mixed-1",
                "kind": "mixed",
                "name": "混合 1",
                "order": 1,
                "locked": False,
                "hidden": False,
                "muted": False,
                "clips": [],
            },
            {
                "id": "audio-1",
                "kind": "audio",
                "name": "音频 1",
                "order": 2,
                "locked": False,
                "hidden": False,
                "muted": False,
                "clips": [],
            },
        ],
    }


class VideoEditorProjects:
    def __init__(self, session: AsyncSession, workspace_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.storage = AssetStorage(get_settings())

    async def row(self, project_id: str) -> VideoEditorProject:
        return await load_workspace_project(
            self.session,
            VideoEditorProject,
            project_id,
            self.workspace_id,
            not_found=lambda: VideoEditorNotFoundError("剪辑项目不存在"),
        )

    async def list(self) -> VideoEditorProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(VideoEditorProject)
                    .where(VideoEditorProject.workspace_id == self.workspace_id)
                    .order_by(VideoEditorProject.updated_at.desc())
                )
            )
            .scalars()
            .all()
        )
        return VideoEditorProjectListOut(items=[project_out(row) for row in rows])

    async def get(self, project_id: str) -> VideoEditorProjectOut:
        return project_out(await self.row(project_id))

    async def create(self, body: VideoEditorProjectCreateIn) -> VideoEditorProjectOut:
        row = VideoEditorProject(workspace_id=self.workspace_id, title=body.title, status="draft")
        self.session.add(row)
        await self.session.flush()
        async with creating_project_layout(
            self.session,
            self.storage,
            "video-editor",
            row.id,
            workspace_id=self.workspace_id,
        ):
            self.session.add(VideoEditorTimeline(project_id=row.id, document=default_timeline()))
        await self.session.refresh(row)
        return project_out(row)

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
        await patch_revisioned_project(
            self.session,
            VideoEditorProject,
            project_id,
            self.workspace_id,
            expected_revision=body.expected_revision,
            values=values,
            load_current=lambda: self.get(project_id),
        )
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
        async with deleting_project_layout(
            self.session,
            self.storage,
            "video-editor",
            project_id,
            workspace_id=self.workspace_id,
            legacy_paths=legacy,
        ):
            await delete_revisioned_project(
                self.session,
                VideoEditorProject,
                project_id,
                self.workspace_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
