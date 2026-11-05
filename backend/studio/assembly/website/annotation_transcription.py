"""Compatibility execution binds the owned project to the shared Models use case."""

from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.model_service.call_logs.credentials import snapshot_from_principal
from studio.apps.model_service.transcription.annotation import (
    AnnotationTranscriptionError,
)


class WebsiteTranscription:
    def __init__(self, session, models):
        self.session, self.models = session, models

    async def __call__(self, project_id, *, owner_user_id, principal=None, upload, **kwargs):
        try:
            credential = (
                await snapshot_from_principal(self.session, principal) if principal else None
            )
            result = await self.models.transcribe(
                project_id,
                owner_user_id=owner_user_id,
                credential=credential,
                upload=upload,
                **kwargs,
            )
            return AudioAnnotationSegmentTranscriptionOut.model_validate(result.model_dump())
        except AnnotationTranscriptionError as exc:
            raise AudioAnnotationError(str(exc), code=exc.code, status=exc.status) from exc
