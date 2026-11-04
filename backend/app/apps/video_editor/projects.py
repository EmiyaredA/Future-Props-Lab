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
from app.runtime.ids import new_id
from app.runtime.project_records import (
    delete_revisioned_project,
    load_owned_project,
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
        "transitions": [],
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
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def row(self, project_id: str) -> VideoEditorProject:
        return await load_owned_project(
            self.session,
            VideoEditorProject,
            project_id,
            self.owner_user_id,
            not_found=lambda: VideoEditorNotFoundError("剪辑项目不存在"),
        )

    async def list(self) -> VideoEditorProjectListOut:
        rows = (
            (
                await self.session.execute(
                    select(VideoEditorProject)
                    .where(VideoEditorProject.owner_user_id == self.owner_user_id)
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
        row = VideoEditorProject(
            id=new_id(), owner_user_id=self.owner_user_id, title=body.title, status="draft"
        )
        resources = self.session.info["video_project_layouts"](self.session, self.owner_user_id)
        async with resources.create_layout(row.id):
            self.session.add(row)
            await self.session.flush()
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
            self.owner_user_id,
            expected_revision=body.expected_revision,
            values=values,
            load_current=lambda: self.get(project_id),
        )
        await self.session.commit()
        return await self.get(project_id)

    async def delete(self, project_id: str, expected_revision: int) -> None:
        await self.row(project_id)
        resources = self.session.info["video_project_layouts"](self.session, self.owner_user_id)
        async with resources.delete_layout(project_id, expected_revision):
            await delete_revisioned_project(
                self.session,
                VideoEditorProject,
                project_id,
                self.owner_user_id,
                expected_revision=expected_revision,
                load_current=lambda: self.get(project_id),
            )
