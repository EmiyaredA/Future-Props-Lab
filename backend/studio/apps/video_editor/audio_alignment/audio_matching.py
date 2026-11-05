"""Read-only music seam suggestions from a project's source audio."""

from __future__ import annotations

import asyncio

from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.media_rendering.audio_matching import AudioMatchError, match_audio
from studio.apps.video_editor.audio_alignment.audio_seam_edit import audio_seam_pair, seam_window
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.media import VideoEditorMedia
from studio.apps.video_editor.schemas.audio_seam import (
    AudioSeamCandidatesIn,
    AudioSeamCandidatesOut,
)
from studio.apps.video_editor.timeline import VideoEditorTimelines
from studio.runtime.revisions import RevisionConflictError


class VideoEditorAudioMatching:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id

    async def candidates(
        self,
        project_id: str,
        body: AudioSeamCandidatesIn,
    ) -> AudioSeamCandidatesOut:
        timeline = await VideoEditorTimelines(self.session, self.owner_user_id).row(project_id)
        if timeline.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision,
                timeline.revision,
                VideoEditorTimelines.out(timeline).model_dump(mode="json", by_alias=True),
            )
        _track, source, target = audio_seam_pair(
            timeline.document, body.from_clip_id, body.to_clip_id
        )
        media = VideoEditorMedia(self.session, self.owner_user_id)
        asset, metadata = await media.asset(project_id, source["assetId"])
        if asset.media_kind != "audio" or metadata.processing_status != "ready":
            raise VideoEditorValidationError("音频素材尚未准备好", code="audio_not_ready")
        duration_us = int((metadata.probe or {}).get("durationUs") or 0)
        source_end, search_end, rate = seam_window(source, target, duration_us)
        path = media.storage.path_for(asset)
        identity = asset.id
        await self.session.rollback()
        try:
            return await asyncio.to_thread(
                match_audio,
                path,
                asset_id=identity,
                duration_us=duration_us,
                reference_end_us=source_end,
                search_end_us=search_end,
                rate=rate,
            )
        except AudioMatchError as exc:
            raise VideoEditorValidationError(str(exc), code=exc.code) from exc
