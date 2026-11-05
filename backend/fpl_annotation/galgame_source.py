"""Read one account's exact annotation document as a Galgame source snapshot."""

from sqlalchemy import select

from app.apps.audio_annotation.models import AudioAnnotationDocument, AudioAnnotationProject
from app.apps.audio_annotation.schemas.document import (
    AudioAnnotationSegment,
    AudioAnnotationSpeaker,
)
from fpl_runtime.galgame_annotation_source import AnnotationSource
from fpl_runtime.project_errors import ProjectResourceError


async def read_source(session, owner, source_id):
    result = (
        await session.execute(
            select(AudioAnnotationProject, AudioAnnotationDocument)
            .join(
                AudioAnnotationDocument,
                AudioAnnotationDocument.project_id == AudioAnnotationProject.id,
            )
            .where(
                AudioAnnotationProject.id == source_id,
                AudioAnnotationProject.owner_user_id == owner,
            )
        )
    ).one_or_none()
    if result is None:
        raise ProjectResourceError("广播剧标注项目不存在")
    project, document = result
    return AnnotationSource(
        id=project.id,
        asset_id=project.asset_id,
        duration_ms=project.duration_ms,
        revision=document.revision,
        speakers=[
            AudioAnnotationSpeaker.model_validate(item).model_dump() for item in document.speakers
        ],
        segments=[
            AudioAnnotationSegment.model_validate(item).model_dump() for item in document.segments
        ],
    )
