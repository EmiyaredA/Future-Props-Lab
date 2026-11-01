from sqlalchemy import select

from app.capabilities.transcription import (
    model_supports_transcription,
    parameter_capabilities,
    resolve_parameters,
)
from app.capabilities.transcription.schemas import ModelTestTranscriptionParametersIn
from app.llm.local_models.catalog import credential_ready, require_ready
from app.llm.models import ModelEntry, ModelProvider
from app.llm.providers import autodl_workflows
from app.llm.providers.chat_completions import TEXT_PROVIDER_KINDS
from app.llm.providers.local_qwen import speech_parameters
from app.llm.providers.seedance_parameters import normalize_video_parameters, video_capabilities
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.llm.providers.volcengine_image import SEEDREAM_MODEL, SEEDREAM_SIZES
from app.llm.schemas.generation_tasks import (
    AudioGenerationTaskCreateIn,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)
from app.llm.schemas.local_models import SpeechSynthesisParameters
from app.llm.schemas.model_inference import InferenceModelOut, InferenceOptionsOut, InferenceTextIn
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

GENERATION_KINDS = {
    "senseaudio_image": "image",
    "volcengine_image": "image",
    "senseaudio_video": "video",
    "volcengine_video": "video",
    "autodl_video": "video",
    "senseaudio_music": "music",
    "senseaudio_sfx": "sound_effect",
}


def modalities(model, provider):
    result = []
    if provider.kind == "local_qwen_tts" and "speech_synthesis" in model.capabilities:
        result.append("speech_synthesis")
    if provider.kind in TEXT_PROVIDER_KINDS and "chat" in model.capabilities:
        result.append("text")
    kind = GENERATION_KINDS.get(provider.kind)
    capability = "image" if kind == "image" else "video" if kind == "video" else "audio"
    if kind and capability + "_generation" in model.capabilities:
        result.append(kind)
    if model_supports_transcription(model, provider):
        result.append("transcription")
    return result


async def get_model(session, owner_user_id, model_id, kind):
    row = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(
                ModelProvider,
                ModelProvider.id == ModelEntry.provider_id,
            )
            .where(
                ModelEntry.id == model_id,
                ModelProvider.owner_user_id == owner_user_id,
                ModelEntry.owner_user_id == owner_user_id,
            )
        )
    ).first()
    if row is None:
        raise OperationError("模型不存在", "not_found", 404)
    model, provider = row
    if not model.enabled or not provider.enabled or not credential_ready(provider):
        raise OperationError("模型未启用或缺少凭证", "model_unavailable", 409)
    if provider.kind == "local_qwen_tts":
        await require_ready(session, model.slug)
    if kind not in modalities(model, provider):
        raise OperationError("模型不支持所选调用方式", "unsupported_modality")
    if provider.kind == "volcengine_image" and model.slug != SEEDREAM_MODEL:
        raise OperationError("当前方舟图片适配仅支持 Seedream 4.5")
    return model, provider


async def options(session, owner_user_id):
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(
                ModelProvider,
                ModelProvider.id == ModelEntry.provider_id,
            )
            .where(
                ModelEntry.owner_user_id == owner_user_id,
                ModelProvider.owner_user_id == owner_user_id,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
            )
        )
    ).all()
    items = []
    for model, provider in rows:
        kinds = modalities(model, provider)
        if not kinds or not credential_ready(provider):
            continue
        if provider.kind == "local_qwen_tts":
            try:
                await require_ready(session, model.slug)
            except OperationError:
                continue
        parameters = {}
        if "speech_synthesis" in kinds:
            parameters["speech_synthesis"] = speech_parameters()
        if "video" in kinds and provider.kind in {"volcengine_video", "autodl_video"}:
            try:
                caps = video_capabilities(
                    provider.kind,
                    model.slug,
                    upload_configured=bool(get_settings().fpl_temp_media_upload_url),
                )
            except ValueError:
                continue
            parameters["video"] = {"video_capabilities": caps.model_dump(mode="json")}
        if "text" in kinds:
            text_schema = InferenceTextIn.model_json_schema()
            text_schema["properties"].pop("model_id")
            text_schema["required"].remove("model_id")
            parameters["text"] = {
                "schema": text_schema,
                "vision": "vision" in model.capabilities,
                "max_image_bytes": 8 * 1024 * 1024,
            }
        if "image" in kinds:
            parameters["image"] = {
                "sizes": list(SEEDREAM_SIZES)
                if provider.kind == "volcengine_image"
                else IMAGE_MODEL_SIZES.get(model.slug, []),
                "max_reference_images": 14 if provider.kind == "volcengine_image" else 1,
                "reference_mime_types": ["image/jpeg", "image/png", "image/webp"],
                "supports_seed": provider.kind != "volcengine_image",
                "max_prompt_length": 2000,
            }
        if "transcription" in kinds:
            parameters["transcription"] = parameter_capabilities(model, provider).model_dump(
                mode="json"
            )
        for kind in kinds:
            if kind in {"image", "video", "music", "sound_effect"}:
                cls = (
                    ImageGenerationTaskCreateIn
                    if kind == "image"
                    else VideoGenerationTaskCreateIn
                    if kind == "video"
                    else AudioGenerationTaskCreateIn
                )
                parameter_schema = cls.model_json_schema()
                excluded = {"model_id", "kind", "canvas_node_id", "expected_canvas_revision"}
                parameter_schema["properties"] = {
                    key: value
                    for key, value in parameter_schema["properties"].items()
                    if key not in excluded
                }
                parameter_schema["required"] = [
                    key for key in parameter_schema.get("required", []) if key not in excluded
                ]
                parameters.setdefault(kind, {})["schema"] = parameter_schema
        items.append(
            InferenceModelOut(
                id=model.id, label=model.label, modalities=kinds, parameters=parameters
            )
        )
    return InferenceOptionsOut(items=items)


def normalize_parameters(body, model, provider, assets):
    params = dict(body.parameters)
    if body.kind == "speech_synthesis":
        payload = SpeechSynthesisParameters.model_validate(params).model_dump()
        if (
            body.asset_ids != [payload["reference_asset_id"]]
            or len(assets) != 1
            or assets[0].media_kind != "audio"
        ):
            raise OperationError("语音合成需要一份已上传的参考录音")
        return payload
    if body.kind == "transcription":
        cls = ModelTestTranscriptionParametersIn
    else:
        cls = (
            ImageGenerationTaskCreateIn
            if body.kind == "image"
            else VideoGenerationTaskCreateIn
            if body.kind == "video"
            else AudioGenerationTaskCreateIn
        )
    forbidden = {"model_id", "kind", "canvas_node_id", "expected_canvas_revision"}
    if set(params) - (set(cls.model_fields) - forbidden):
        raise OperationError("包含不支持的模型参数")
    if body.kind == "transcription":
        return resolve_parameters(cls.model_validate(params), model, provider).model_dump(
            mode="json"
        )
    if body.kind in {"music", "sound_effect"}:
        expected_mode = "sfx" if body.kind == "sound_effect" else "music"
        if "mode" in params and params["mode"] != expected_mode:
            raise OperationError("音频 mode 与任务 kind 不一致")
        params.update(
            kind="audio", model_id=model.id, mode="sfx" if body.kind == "sound_effect" else "music"
        )
    else:
        params.update(kind=body.kind, model_id=model.id)
    payload = cls.model_validate(params).model_dump(mode="json", exclude=forbidden)
    by_id = {asset.id: asset for asset in assets}
    references = []
    for field, value in payload.items():
        if field.endswith("asset_id") and value:
            references.append(value)
        if field.endswith("asset_ids"):
            references.extend(value or [])
    if set(references) != set(body.asset_ids):
        raise OperationError("asset_ids 必须与模型参数中引用的素材完全一致")
    for field, kind in (
        ("reference_asset_id", "image"),
        ("first_frame_asset_id", "image"),
        ("last_frame_asset_id", "image"),
        ("reference_asset_ids", "audio" if body.kind == "music" else "image"),
        ("audio_asset_ids", "audio"),
        ("video_asset_ids", "video"),
    ):
        ids = payload.get(field) or []
        for identity in [ids] if isinstance(ids, str) else ids:
            if by_id[identity].media_kind != kind:
                raise OperationError("参考素材类型不匹配")
    image_sizes = (
        SEEDREAM_SIZES
        if provider.kind == "volcengine_image"
        else IMAGE_MODEL_SIZES.get(model.slug, [])
    )
    if body.kind == "image" and len(set(references)) > (
        14 if provider.kind == "volcengine_image" else 1
    ):
        raise OperationError("当前模型不支持此参考图数量")
    if body.kind == "image" and payload["size"] not in image_sizes:
        raise OperationError("当前模型不支持所选图片尺寸")
    if body.kind == "image" and provider.kind == "volcengine_image":
        if payload.get("seed") is not None:
            raise OperationError("Seedream 4.5 不支持指定随机种子")
        if any(
            by_id[identity].mime_type not in {"image/jpeg", "image/png", "image/webp"}
            for identity in references
        ):
            raise OperationError("Seedream 4.5 参考图片只支持 PNG、JPEG 或 WebP")
    if body.kind == "video":
        try:
            payload = normalize_video_parameters(provider.kind, model.slug, payload)
            if provider.kind == "autodl_video":
                autodl_workflows.validate_references(
                    model.slug, [(a.media_kind, a.mime_type, a.byte_size) for a in assets]
                )
        except ValueError as exc:
            raise OperationError(str(exc)) from None
    return payload
