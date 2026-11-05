"""Compatibility execution binds the owned project to the shared Models use case."""

from studio.apps.audio_annotation.schemas.document import AudioAnnotationSegmentTranscriptionOut
from studio.apps.audio_annotation.sources import AudioAnnotationError
from studio.apps.audio_annotation.storage.transcription_scope import transcribe_project
from studio.apps.model_service.call_logs.credentials import snapshot_from_principal
from studio.apps.model_service.transcription.annotation import (
    AnnotationTranscription,
    AnnotationTranscriptionError,
)


async def legacy_transcribe(session, project_id, *, principal=None, upload, **kwargs):
    try:
        owner = await transcribe_project(session, project_id, kwargs["start_ms"], kwargs["end_ms"])
        credential = await snapshot_from_principal(session, principal) if principal else None
        result = await AnnotationTranscription(session).transcribe(
            project_id, owner_user_id=owner, credential=credential, upload=upload, **kwargs
        )
        return AudioAnnotationSegmentTranscriptionOut.model_validate(result.model_dump())
    except AnnotationTranscriptionError as exc:
        raise AudioAnnotationError(str(exc), code=exc.code, status=exc.status) from exc
    finally:
        await upload.close()
