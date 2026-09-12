from sqlalchemy import select

from app.concurrency.operation_receipts import OperationError
from app.llm.providers.senseaudio_image import IMAGE_MODEL_SIZES
from app.llm.transcription import (
    model_supports_transcription,
    parameter_capabilities,
    resolve_parameters,
)
from app.models import ModelEntry, ModelProvider
from app.schemas.model_inference import InferenceModelOut, InferenceOptionsOut, InferenceTextIn
from app.schemas.transcription import ModelTestTranscriptionParametersIn
from app.schemas.visual_workshop import (
    AudioGenerationTaskCreateIn,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)

GENERATION_KINDS = {
    "senseaudio_image": "image",
    "senseaudio_video": "video",
    "senseaudio_music": "music",
    "senseaudio_sfx": "sound_effect",
}


def modalities(model, provider):
    result = []
    if provider.kind in {"openai", "anthropic"} and "chat" in model.capabilities:
        result.append("text")
    kind = GENERATION_KINDS.get(provider.kind)
    capability = "image" if kind == "image" else "video" if kind == "video" else "audio"
    if kind and capability + "_generation" in model.capabilities:
        result.append(kind)
    if model_supports_transcription(model, provider):
        result.append("transcription")
    return result


async def get_model(session, workspace_id, model_id, kind):
    row = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(
                ModelProvider,
                ModelProvider.id == ModelEntry.provider_id,
            )
            .where(
                ModelEntry.id == model_id,
                ModelProvider.workspace_id == workspace_id,
                ModelEntry.workspace_id == workspace_id,
            )
        )
    ).first()
    if row is None:
        raise OperationError("模型不存在", "not_found", 404)
    model, provider = row
    if not model.enabled or not provider.enabled or not provider.api_key_ciphertext:
        raise OperationError("模型未启用或缺少凭证", "model_unavailable", 409)
    if kind not in modalities(model, provider):
        raise OperationError("模型不支持所选调用方式", "unsupported_modality")
    return model, provider


async def options(session, workspace_id):
    rows = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(
                ModelProvider,
                ModelProvider.id == ModelEntry.provider_id,
            )
            .where(
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
                ModelEntry.enabled.is_(True),
                ModelProvider.enabled.is_(True),
            )
        )
    ).all()
    items = []
    for model, provider in rows:
        kinds = modalities(model, provider)
        if not kinds or not provider.api_key_ciphertext:
            continue
        parameters = {}
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
            parameters["image"] = {"sizes": IMAGE_MODEL_SIZES.get(model.slug, [])}
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
    if body.kind == "image" and payload["size"] not in IMAGE_MODEL_SIZES.get(model.slug, []):
        raise OperationError("当前模型不支持所选图片尺寸")
    return payload
