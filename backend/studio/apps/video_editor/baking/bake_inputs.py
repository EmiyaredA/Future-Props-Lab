"""Validate a versioned chroma bake against its owned source and processing state."""

from studio.apps.video_editor.asset_output import asset_output
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.schemas import VideoEditorDefaultEffects
from studio.runtime.revisions import RevisionConflictError


def bake_effects(project_id, asset, metadata, body):
    if metadata.revision != body.expected_revision:
        raise RevisionConflictError(
            body.expected_revision,
            metadata.revision,
            asset_output(project_id, asset, metadata).model_dump(mode="json"),
        )
    if asset.media_kind not in {"video", "image"}:
        raise VideoEditorValidationError("只有视频和图片可以烘焙抠像", code="invalid_kind")
    if metadata.processing_status != "ready":
        raise VideoEditorValidationError("素材尚未处理完成", code="asset_not_ready")

    effects = body.effects or VideoEditorDefaultEffects.model_validate(
        metadata.default_effects or {}
    )
    if effects.chroma_key is None or not effects.chroma_key.enabled:
        raise VideoEditorValidationError("烘焙需要启用抠像参数", code="chroma_required")
    return effects
