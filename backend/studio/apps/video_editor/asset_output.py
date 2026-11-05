"""Format Video Editor media metadata without sharing its file storage."""

from studio.apps.video_editor.schemas import VideoEditorAssetOut, VideoEditorDefaultEffects
from studio.runtime.time import iso_utc


def asset_output(project_id, asset, metadata):
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
        defaultEffects=VideoEditorDefaultEffects.model_validate(metadata.default_effects or {}),
        revision=metadata.revision,
        createdAt=iso_utc(asset.created_at),
    )
