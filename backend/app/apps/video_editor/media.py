from __future__ import annotations

import json
import mimetypes
import subprocess
from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.schemas import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAssetPatchIn,
    VideoEditorAvailableAssetListOut,
    VideoEditorAvailableAssetOut,
    VideoEditorDefaultEffects,
)
from app.capabilities.asset_store.incoming import IncomingFile
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import VIDEO_EDITABLE_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import Settings, get_settings
from app.runtime.revisions import RevisionConflictError, require_revision_write
from app.runtime.time import iso_utc, utc_now

VIDEO_EDITOR_EXTENSIONS = VIDEO_EDITABLE_EXTENSIONS


def probe_media(path: Path) -> dict:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration,format_name:stream=index,codec_type,codec_name,width,height,avg_frame_rate,pix_fmt,nb_frames,sample_rate,channels",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    payload = json.loads(result.stdout)
    duration = float((payload.get("format") or {}).get("duration") or 0)
    payload["durationUs"] = max(0, round(duration * 1_000_000))
    return payload


class VideoEditorMedia:
    def __init__(
        self, session: AsyncSession, owner_user_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)
        self.library = AssetLibrary(session, self.settings)

    async def _project(self, project_id: str) -> None:
        await VideoEditorProjects(self.session, self.owner_user_id).row(project_id)

    def _out(
        self, project_id: str, asset: VisualAsset, metadata: VideoEditorAssetMetadata
    ) -> VideoEditorAssetOut:
        base = f"/v1/video-editor/projects/{project_id}/assets/{asset.id}"
        effects = VideoEditorDefaultEffects.model_validate(metadata.default_effects or {})
        return VideoEditorAssetOut(
            id=asset.id,
            displayName=asset.display_name,
            originalFilename=asset.original_filename,
            mediaKind=asset.media_kind,
            mimeType=asset.mime_type,
            byteSize=asset.byte_size,
            processingStatus=metadata.processing_status,
            probe=metadata.probe or {},
            proxyUrl=f"{base}/proxy" if metadata.proxy_filename else None,
            thumbnailUrl=f"{base}/thumbnail" if metadata.thumbnail_filename else None,
            waveformUrl=f"{base}/waveform" if metadata.waveform_filename else None,
            error=metadata.error,
            defaultEffects=effects,
            revision=metadata.revision,
            createdAt=iso_utc(asset.created_at),
        )

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
            items=[self._out(project_id, asset, meta) for asset, meta in rows]
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
        return self._out(project_id, asset, metadata)

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
            items=[self._out(project_id, asset, metadata) for asset, metadata in created]
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
        return self._out(project_id, asset, metadata)

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
            return self._out(project_id, current_asset, current_meta)

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
        return self._out(project_id, asset, metadata)

    async def delete(self, project_id: str, asset_id: str) -> None:
        asset, _metadata = await self.asset(project_id, asset_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        document = deepcopy(timeline.document) if timeline else None
        if document and any(
            clip.get(key) == asset_id
            for track in document.get("tracks", [])
            for clip in track.get("clips", [])
            for key in ("assetId", "fontAssetId")
        ):
            raise VideoEditorValidationError("素材仍被时间轴引用", code="asset_in_use")
        path = self.storage.path_for(asset)
        await self.session.delete(asset)
        if timeline and document:
            organization = document.get("assetOrganization") or {}
            root_asset_ids = organization.get("rootAssetIds") or []
            changed = asset_id in root_asset_ids
            organization["rootAssetIds"] = [item for item in root_asset_ids if item != asset_id]
            for folder in organization.get("folders") or []:
                folder_asset_ids = folder.get("assetIds") or []
                if asset_id in folder_asset_ids:
                    changed = True
                folder["assetIds"] = [item for item in folder_asset_ids if item != asset_id]
            if changed:
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
