"""Select the same eligible provider and model in both Visual deployments."""

from sqlalchemy import select

from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers.seedance_parameters import video_capabilities
from app.llm.providers.volcengine_image import SEEDREAM_MODEL


class VisualGenerationValidationError(Exception):
    def __init__(self, message, *, code, status=422):
        super().__init__(message)
        self.code, self.status = code, status


async def select_visual_model(session, owner, model_id, kind, audio_mode=None):
    model = await session.scalar(
        select(ModelEntry).where(ModelEntry.id == model_id, ModelEntry.owner_user_id == owner)
    )
    if model is None:
        raise VisualGenerationValidationError(
            "生成模型不存在", code="model_unavailable", status=404
        )
    provider = await session.scalar(
        select(ModelProvider).where(
            ModelProvider.id == model.provider_id, ModelProvider.owner_user_id == owner
        )
    )
    capability = f"{kind}_generation"
    expected_provider_kind = f"senseaudio_{audio_mode}" if kind == "audio" else f"senseaudio_{kind}"
    if (
        provider is None
        or not provider.enabled
        or not model.enabled
        or provider.kind
        not in (
            {"senseaudio_image", "volcengine_image"}
            if kind == "image"
            else {"senseaudio_video", "zealman_video", "volcengine_video", "autodl_video"}
            if kind == "video"
            else {expected_provider_kind}
        )
        or capability not in list(model.capabilities or [])
    ):
        raise VisualGenerationValidationError(
            "当前生成模型不可用", code="model_unavailable", status=409
        )
    if provider.kind != "zealman_video" and not provider.api_key_ciphertext:
        raise VisualGenerationValidationError(
            "供应商尚未配置 API Key", code="missing_api_key", status=409
        )
    if provider.kind == "volcengine_image" and model.slug != SEEDREAM_MODEL:
        raise VisualGenerationValidationError(
            "当前方舟图片适配仅支持 Seedream 4.5", code="unsupported_model"
        )
    try:
        video_capabilities(provider.kind, model.slug)
    except ValueError as exc:
        raise VisualGenerationValidationError(str(exc), code="unsupported_model") from None
    return model, provider
