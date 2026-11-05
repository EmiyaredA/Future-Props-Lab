from __future__ import annotations

import mimetypes
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.video_editor.asset_output import asset_output
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.projects import VideoEditorProjects
from studio.apps.video_editor.schemas import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAssetPatchIn,
    VideoEditorAvailableAssetListOut,
    VideoEditorAvailableAssetOut,
)
from studio.apps.video_editor.storage.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
)
from studio.apps.video_editor.timeline_file_removal import without_file
from studio.config.settings import Settings
from studio.contracts.asset_library.file_types import VIDEO_EDITABLE_EXTENSIONS
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.revisions import RevisionConflictError, require_revision_write
from studio.runtime.time import iso_utc, utc_now

VIDEO_EDITOR_EXTENSIONS = VIDEO_EDITABLE_EXTENSIONS


class VideoEditorMedia:
    def __init__(self, session: AsyncSession, owner_user_id: str, *, settings: Settings) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.settings = settings
        self.storage = AssetStorage(self.settings)
        self.library = AssetLibrary(session, self.settings)

    async def _project(self, project_id: str) -> None:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)

    async def list(self, project_id: str) -> VideoEditorAssetListOut:
        await self._project(project_id)
        rows = (
            await self.session.execute(
                select(VisualAsset, VideoEditorAssetMetadata)
                .join(VideoEditorAssetMetadata, VideoEditorAssetMetadata.asset_id == VisualAsset.id)
                .where(VisualAsset.video_editor_project_id == project_id)
                .order_by(VisualAsset.created_at.desc())
            )
        ).all()
        return VideoEditorAssetListOut(
            items=[asset_output(project_id, asset, meta) for asset, meta in rows]
        )

    async def available(self) -> VideoEditorAvailableAssetListOut:
        rows = (
            (
                await self.session.execute(
                    select(VisualAsset)
                    .where(VisualAsset.video_editor_project_id.is_(None))
                    .order_by(VisualAsset.updated_at.desc())
                    .limit(500)
                )
            )
            .scalars()
            .all()
        )
        return VideoEditorAvailableAssetListOut(
            items=[
                VideoEditorAvailableAssetOut(
                    id=row.id,
                    displayName=row.display_name,
                    mediaKind=row.media_kind,
                    mimeType=row.mime_type,
                    sourceApplication=(
                        "galgame-workshop"
                        if row.galgame_project_id
                        else "visual-workshop"
                        if row.project_id
                        else "file-library"
                    ),
                )
                for row in rows
                if Path(row.original_filename).suffix.lower() in VIDEO_EDITOR_EXTENSIONS
            ]
        )

    async def _register(self, project_id: str, asset: VisualAsset) -> VideoEditorAssetOut:
        metadata = VideoEditorAssetMetadata(asset_id=asset.id, project_id=project_id)
        task = VideoEditorTask(
            owner_user_id=self.owner_user_id,
            project_id=project_id,
            request_id=f"media-{asset.id}",
            kind="media",
            status="queued",
            request_payload={"assetId": asset.id},
        )
        self.session.add_all((metadata, task))
        await self.session.commit()
        await self.session.refresh(metadata)
        return asset_output(project_id, asset, metadata)

    async def upload(self, project_id: str, upload: IncomingFile) -> VideoEditorAssetOut:
        await self._project(project_id)
        asset = await self.library.store_upload(
            upload,
            owner_user_id=self.owner_user_id,
            video_editor_project_id=project_id,
            allowed_extensions=VIDEO_EDITOR_EXTENSIONS,
        )
        return await self._register(project_id, asset)

    async def import_assets(
        self, project_id: str, body: VideoEditorAssetImportIn
    ) -> VideoEditorAssetListOut:
        await self._project(project_id)
        sources = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.id.in_(body.asset_ids),
                        VisualAsset.video_editor_project_id.is_(None),
                    )
                )
            ).scalars()
        )
        if {row.id for row in sources} != set(body.asset_ids):
            raise VideoEditorValidationError("有素材不存在或不可导入", code="invalid_asset")
        staged: list[Path] = []
        created: list[tuple[VisualAsset, VideoEditorAssetMetadata]] = []
        try:
            for source in sources:
                asset, path = await self.library.stage_local_copy(
                    self.storage.path_for(source),
                    owner_user_id=self.owner_user_id,
                    filename=source.original_filename,
                    content_type=source.mime_type,
                    video_editor_project_id=project_id,
                    allowed_extensions=VIDEO_EDITOR_EXTENSIONS,
                )
                staged.append(path)
                metadata = VideoEditorAssetMetadata(asset_id=asset.id, project_id=project_id)
                self.session.add(metadata)
                self.session.add(
                    VideoEditorTask(
                        owner_user_id=self.owner_user_id,
                        project_id=project_id,
                        request_id=f"media-{asset.id}",
                        kind="media",
                        request_payload={"assetId": asset.id},
                    )
                )
                created.append((asset, metadata))
            await self.session.commit()
        except Exception:
            await self.session.rollback()
            for path in staged:
                path.unlink(missing_ok=True)
            raise
        return VideoEditorAssetListOut(
            items=[asset_output(project_id, asset, metadata) for asset, metadata in created]
        )

    async def asset(
        self, project_id: str, asset_id: str
    ) -> tuple[VisualAsset, VideoEditorAssetMetadata]:
        row = (
            await self.session.execute(
                select(VisualAsset, VideoEditorAssetMetadata)
                .join(VideoEditorAssetMetadata, VideoEditorAssetMetadata.asset_id == VisualAsset.id)
                .where(
                    VisualAsset.id == asset_id,
                    VisualAsset.video_editor_project_id == project_id,
                )
            )
        ).one_or_none()
        if row is None:
            raise VideoEditorNotFoundError("素材不存在")
        return row

    async def retry(self, project_id: str, asset_id: str) -> VideoEditorAssetOut:
        asset, metadata = await self.asset(project_id, asset_id)
        metadata.processing_status = "queued"
        metadata.error = None
        metadata.revision += 1
        self.session.add(
            VideoEditorTask(
                owner_user_id=self.owner_user_id,
                project_id=project_id,
                request_id=f"media-{asset.id}-{uuid4().hex[:12]}",
                kind="media",
                request_payload={"assetId": asset.id},
            )
        )
        await self.session.commit()
        return asset_output(project_id, asset, metadata)

    async def patch(
        self, project_id: str, asset_id: str, body: VideoEditorAssetPatchIn
    ) -> VideoEditorAssetOut:
        asset, metadata = await self.asset(project_id, asset_id)
        if (
            body.default_effects is not None
            and asset.media_kind not in {"video", "image"}
            and body.default_effects.chroma_key is not None
        ):
            raise VideoEditorValidationError(
                "只有视频和图片素材可以设置抠像默认效果", code="invalid_kind"
            )
        now = utc_now()
        changes = {"revision": body.expected_revision + 1, "updated_at": now}
        if body.default_effects is not None:
            changes["default_effects"] = body.default_effects.model_dump(mode="json", by_alias=True)
        result = await self.session.execute(
            update(VideoEditorAssetMetadata)
            .where(
                VideoEditorAssetMetadata.asset_id == asset_id,
                VideoEditorAssetMetadata.project_id == project_id,
                VideoEditorAssetMetadata.revision == body.expected_revision,
            )
            .values(**changes)
        )

        async def load_current() -> VideoEditorAssetOut:
            current_asset, current_meta = await self.asset(project_id, asset_id)
            return asset_output(project_id, current_asset, current_meta)

        await require_revision_write(
            self.session,
            result,
            expected=body.expected_revision,
            load_current=load_current,
        )
        if body.display_name is not None:
            asset.display_name = body.display_name
        await self.session.commit()
        asset, metadata = await self.asset(project_id, asset_id)
        return asset_output(project_id, asset, metadata)

    async def delete(self, project_id: str, asset_id: str) -> None:
        asset, _metadata = await self.asset(project_id, asset_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        document = without_file(timeline.document, asset_id) if timeline else None
        path = self.storage.path_for(asset)
        await self.session.delete(asset)
        if document is not None:
            expected_revision = timeline.revision
            now = utc_now()
            result = await self.session.execute(
                update(VideoEditorTimeline)
                .where(
                    VideoEditorTimeline.project_id == project_id,
                    VideoEditorTimeline.revision == expected_revision,
                )
                .values(
                    document=document,
                    revision=expected_revision + 1,
                    updated_at=now,
                )
            )
            if result.rowcount != 1:
                await self.session.rollback()
                current = await self.session.get(VideoEditorTimeline, project_id)
                current_revision = current.revision if current else expected_revision
                raise RevisionConflictError(
                    expected_revision,
                    current_revision,
                    {
                        "projectId": project_id,
                        "revision": current_revision,
                        "document": current.document if current else {},
                        "updatedAt": iso_utc(current.updated_at) if current else "",
                    },
                )
        await self.session.commit()
        path.unlink(missing_ok=True)

    def derived_path(self, project_id: str, filename: str) -> Path:
        if Path(filename).name != filename:
            raise VideoEditorValidationError("派生文件名无效")
        return (
            self.storage.project_root("video-editor", project_id, owner_user_id=self.owner_user_id)
            / "derived"
            / filename
        )


def guessed_mime(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
