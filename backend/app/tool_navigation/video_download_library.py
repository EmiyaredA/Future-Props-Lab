"""Store an authorized download through the website asset-library transaction."""

from pathlib import Path

from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.tool_navigation.video_download import VideoDownloadAssetOut, VideoDownloadJob
from app.tool_navigation.video_download_errors import VideoDownloadError
from app.tool_navigation.video_download_execution import MIME_BY_EXTENSION, VIDEO_EXTENSIONS


async def ingest_library(
    job: VideoDownloadJob,
    media: Path,
    *,
    sessions,
    settings,
) -> VideoDownloadAssetOut:
    async with sessions() as session:
        library = AssetLibrary(session, settings)
        try:
            row, _staged = await library.stage_local_copy(
                media,
                owner_user_id=job.owner_user_id,
                filename=media.name,
                content_type=MIME_BY_EXTENSION.get(media.suffix.lower(), "video/mp4"),
                folder_id=job.folder_id,
                allowed_extensions=VIDEO_EXTENSIONS,
            )
            await session.commit()
            await session.refresh(row)
        except AssetError as exc:
            raise VideoDownloadError(str(exc), code=exc.code, status=exc.status) from exc
        return VideoDownloadAssetOut(
            id=row.id,
            display_name=row.display_name,
            original_filename=row.original_filename,
            mime_type=row.mime_type,
            byte_size=row.byte_size,
        )
