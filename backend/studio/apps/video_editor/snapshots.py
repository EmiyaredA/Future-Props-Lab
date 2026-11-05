from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import (
    AssetStorage,
    ExportedProjectSnapshot,
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
    move_staged_asset,
    stage_project_snapshot,
)
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from studio.apps.video_editor.projects import project_out
from studio.apps.video_editor.schemas import VideoEditorProjectSnapshotImportOut
from studio.apps.video_editor.snapshot_format import remap_timeline, validated_snapshot
from studio.apps.video_editor.snapshot_queries import output_asset_ids, timeline_asset_ids
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.config.settings import Settings
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.ids import new_id


def _asset_record(asset: VisualAsset) -> dict:
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
    }


class VideoEditorProjectSnapshots:
    application_id = "video-editor"

    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(VideoEditorProject).where(
                    VideoEditorProject.id == project_id,
                    VideoEditorProject.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        timeline = await self.session.get(VideoEditorTimeline, project_id) if project else None
        if project is None or timeline is None:
            raise ProjectSnapshotError("剪辑项目不存在", code="not_found", status=404)
        document = deepcopy(timeline.document or {})
        used_ids = timeline_asset_ids(document)
        output_ids = await output_asset_ids(self.session, self.owner_user_id, project_id)
        all_assets = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.video_editor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        selected = [
            asset for asset in all_assets if asset.id not in output_ids or asset.id in used_ids
        ]
        payload = {
            "schema_version": 1,
            "project": {
                "title": project.title,
                "status": project.status,
                "source_application": project.source_application,
                "source_project_id": project.source_project_id,
                "source_revision": project.source_revision,
                "source_compiler_version": project.source_compiler_version,
            },
            "timeline": document,
            "assets": [_asset_record(asset) for asset in selected],
        }
        title = project.title
        source_project = project_out(project).model_dump(mode="json", by_alias=True)
        sources = [
            SnapshotAssetSource(asset.id, self.storage.path_for(asset)) for asset in selected
        ]
        await self.session.rollback()
        return await export_project_snapshot(
            self.settings,
            application_id=self.application_id,
            title=title,
            source_project=source_project,
            project=payload,
            assets=sources,
        )

    async def import_snapshot(self, upload: IncomingFile) -> VideoEditorProjectSnapshotImportOut:
        staged = await stage_project_snapshot(
            self.settings, upload, expected_application=self.application_id
        )
        try:
            details, document, assets = validated_snapshot(staged)
            asset_ids = {item["id"]: new_id() for item in assets}
            timeline_dump = remap_timeline(document, asset_ids)
            project = VideoEditorProject(
                id=new_id(),
                owner_user_id=self.owner_user_id,
                **details,
            )
            self.session.add(project)
            await self.session.flush()
            async with importing_project_layout(
                self.session,
                self.storage,
                self.application_id,
                project.id,
                owner_user_id=self.owner_user_id,
            ):
                for item in assets:
                    storage_key = uuid4().hex
                    new_asset_id = asset_ids[item["id"]]
                    self.session.add(
                        VisualAsset(
                            id=new_asset_id,
                            owner_user_id=self.owner_user_id,
                            video_editor_project_id=project.id,
                            original_filename=item["original_filename"],
                            display_name=item["display_name"],
                            storage_key=storage_key,
                            storage_version=TARGET_STORAGE_VERSION,
                            media_kind=item["media_kind"],
                            mime_type=item["mime_type"],
                            byte_size=item["byte_size"],
                        )
                    )
                    await self.session.flush()
                    self.session.add(
                        VideoEditorAssetMetadata(asset_id=new_asset_id, project_id=project.id)
                    )
                    self.session.add(
                        VideoEditorTask(
                            owner_user_id=self.owner_user_id,
                            project_id=project.id,
                            request_id=f"media-{new_asset_id}",
                            kind="media",
                            status="queued",
                            request_payload={"assetId": new_asset_id},
                        )
                    )
                    move_staged_asset(
                        staged.asset_path(item["id"]),
                        self.storage.target_path(
                            storage_key,
                            visual_project_id=None,
                            galgame_project_id=None,
                            video_editor_project_id=project.id,
                            owner_user_id=self.owner_user_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                self.session.add(VideoEditorTimeline(project_id=project.id, document=timeline_dump))
            await self.session.refresh(project)
            return VideoEditorProjectSnapshotImportOut(project=project_out(project), warnings=[])
        finally:
            staged.cleanup()
