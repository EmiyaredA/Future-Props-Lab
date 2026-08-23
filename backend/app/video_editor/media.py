from __future__ import annotations

import hashlib
import json
import mimetypes
import subprocess
from pathlib import Path
from uuid import uuid4

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings, get_settings
from app.core.time import iso_utc
from app.files.library import AssetLibrary
from app.files.storage import AssetStorage
from app.models import (
    VideoEditorAssetMetadata,
    VideoEditorTask,
    VideoEditorTimeline,
    VisualAsset,
)
from app.schemas.video_editor import (
    VideoEditorAssetImportIn,
    VideoEditorAssetListOut,
    VideoEditorAssetOut,
    VideoEditorAvailableAssetListOut,
    VideoEditorAvailableAssetOut,
)
from app.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from app.video_editor.projects import VideoEditorProjects

VIDEO_EDITOR_EXTENSIONS = {
    ".mp4",
    ".mov",
    ".mkv",
    ".webm",
    ".wav",
    ".mp3",
    ".m4a",
    ".aac",
    ".flac",
    ".ogg",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".ttf",
    ".otf",
    ".woff",
    ".woff2",
}


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


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
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)
        self.library = AssetLibrary(session, self.settings)

    async def _project(self, project_id: str) -> None:
        await VideoEditorProjects(self.session).row(project_id)

    def _out(
        self, project_id: str, asset: VisualAsset, metadata: VideoEditorAssetMetadata
    ) -> VideoEditorAssetOut:
        base = f"/v1/video-editor/projects/{project_id}/assets/{asset.id}"
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

    async def upload(self, project_id: str, upload: UploadFile) -> VideoEditorAssetOut:
        await self._project(project_id)
        asset = await self.library.store_upload(
            upload,
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
                project_id=project_id,
                request_id=f"media-{asset.id}-{uuid4().hex[:12]}",
                kind="media",
                request_payload={"assetId": asset.id},
            )
        )
        await self.session.commit()
        return self._out(project_id, asset, metadata)

    async def delete(self, project_id: str, asset_id: str) -> None:
        asset, _metadata = await self.asset(project_id, asset_id)
        timeline = await self.session.get(VideoEditorTimeline, project_id)
        if timeline and asset_id in json.dumps(timeline.document):
            raise VideoEditorValidationError("素材仍被时间轴引用", code="asset_in_use")
        path = self.storage.path_for(asset)
        await self.session.delete(asset)
        await self.session.commit()
        path.unlink(missing_ok=True)

    def derived_path(self, project_id: str, filename: str) -> Path:
        if Path(filename).name != filename:
            raise VideoEditorValidationError("派生文件名无效")
        return self.storage.project_root("video-editor", project_id) / "derived" / filename


def guessed_mime(path: Path) -> str:
    return mimetypes.guess_type(path.name)[0] or "application/octet-stream"
