"""Optimistic edits of Galgame-owned transcript text."""

from sqlalchemy import update

from studio.apps.galgame_workshop.storage.models import GalgameAssetMetadata
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now


async def write_transcript(session, metadata, asset_id, body):
    project_id = metadata.project_id
    result = await session.execute(
        update(GalgameAssetMetadata)
        .where(
            GalgameAssetMetadata.asset_id == asset_id,
            GalgameAssetMetadata.project_id == project_id,
            GalgameAssetMetadata.transcript_revision == body.expected_revision,
        )
        .values(
            transcript=body.text.strip(),
            transcript_language=body.language or metadata.transcript_language,
            transcript_status="ready",
            transcript_source="manual",
            transcript_revision=body.expected_revision + 1,
            transcript_segments=[],
            updated_at=utc_now(),
        )
    )
    if result.rowcount != 1:
        await session.rollback()
        current = await session.get(GalgameAssetMetadata, asset_id)
        if current is not None and current.project_id != project_id:
            current = None
        raise RevisionConflictError(
            body.expected_revision,
            current.transcript_revision if current else 0,
            {"assetId": asset_id, "transcript": current.transcript if current else None},
        )
    await session.refresh(metadata)
    saved = {
        "assetId": asset_id,
        "transcript": metadata.transcript,
        "language": metadata.transcript_language,
        "source": metadata.transcript_source,
        "revision": metadata.transcript_revision,
    }
    await session.commit()
    return saved
