"""Normalize Visual task arguments using scoped, owner-provided reference metadata."""

from studio.apps.model_service.catalog.visual_generation import VisualGenerationValidationError
from studio.apps.model_service.providers import autodl_workflows
from studio.apps.model_service.providers.seedance_parameters import normalize_video_parameters
from studio.apps.model_service.providers.senseaudio_image import IMAGE_MODEL_SIZES
from studio.apps.model_service.providers.volcengine_image import SEEDREAM_SIZES
from studio.apps.model_service.providers.zealman_workflows import (
    REFERENCE_MIME_TYPES as WORKFLOW_MIME_TYPES,
)
from studio.apps.model_service.providers.zealman_workflows import normalize_request
from studio.contracts.model_service.generation_tasks import (
    AudioGenerationTaskCreateIn,
    ImageGenerationTaskCreateIn,
    VideoGenerationTaskCreateIn,
)
from studio.runtime.files.names import download_filename


async def prepare_visual_payload(
    body,
    *,
    provider_kind,
    model_slug,
    explicit_fields,
    reference_titles,
    input_snapshot,
    reference,
    validate_seedance,
):
    payload = body.model_dump(
        mode="json",
        exclude={"canvas_node_id", "expected_canvas_revision"},
    )
    payload["input_snapshot"] = input_snapshot
    reference_assets = {}
    if isinstance(body, ImageGenerationTaskCreateIn):
        sizes = (
            SEEDREAM_SIZES
            if provider_kind == "volcengine_image"
            else IMAGE_MODEL_SIZES.get(model_slug)
        )
        if not sizes or body.size not in sizes:
            raise VisualGenerationValidationError(
                "当前模型不支持所选图片尺寸", code="unsupported_size"
            )
        prompt_limit = 6000 if model_slug == "senseaudio-image-2.0-260319" else 2000
        if len(body.prompt) > prompt_limit:
            raise VisualGenerationValidationError(
                f"当前模型提示词最多支持 {prompt_limit} 个字符",
                code="prompt_too_long",
            )
        reference_ids = list(
            dict.fromkeys(
                [
                    *body.reference_asset_ids,
                    *([body.reference_asset_id] if body.reference_asset_id else []),
                ]
            )
        )
        if len(reference_ids) > (14 if provider_kind == "volcengine_image" else 1):
            raise VisualGenerationValidationError(
                "当前图片模型不支持所选参考图数量", code="too_many_references"
            )
        if provider_kind == "volcengine_image" and body.seed is not None:
            raise VisualGenerationValidationError(
                "Seedream 4.5 不支持指定随机种子", code="unsupported_parameter"
            )
        for reference_id in reference_ids:
            reference_assets[reference_id] = await reference(reference_id, "image")
            if provider_kind == "volcengine_image" and reference_assets[
                reference_id
            ].mime_type not in {"image/png", "image/jpeg", "image/webp"}:
                raise VisualGenerationValidationError(
                    "Seedream 4.5 参考图仅支持 PNG、JPEG、WebP",
                    code="unsupported_reference_format",
                )
        payload["reference_asset_ids"] = reference_ids
        payload["reference_asset_id"] = reference_ids[0] if len(reference_ids) == 1 else None
    elif isinstance(body, VideoGenerationTaskCreateIn):
        try:
            payload = normalize_video_parameters(provider_kind, model_slug, payload)
        except ValueError as exc:
            raise VisualGenerationValidationError(str(exc), code="unsupported_parameter") from None
        if provider_kind == "zealman_video":
            try:
                payload["workflow_parameters"] = (
                    body.workflow_parameters.model_dump(exclude_unset=True)
                    if body.workflow_parameters
                    else {}
                )
                payload = normalize_request(model_slug, payload, explicit_fields)
            except ValueError as exc:
                raise VisualGenerationValidationError(
                    str(exc), code="unsupported_parameter"
                ) from None
        elif provider_kind != "autodl_video" and body.workflow_parameters is not None:
            raise VisualGenerationValidationError(
                "当前模型不支持工作流参数", code="unsupported_parameter"
            )
        if provider_kind not in {"zealman_video", "autodl_video"}:
            for field, default in {
                "resolution": "720p",
                "ratio": "16:9",
                "watermark": True,
                "generate_audio": False,
            }.items():
                if payload.get(field) is None:
                    payload[field] = default
        image_ids = [
            item
            for item in (
                body.first_frame_asset_id,
                body.last_frame_asset_id,
                *body.reference_asset_ids,
            )
            if item
        ]
        for asset_id in image_ids:
            reference_assets[asset_id] = await reference(asset_id, "image")
        for asset_id in body.audio_asset_ids:
            reference_assets[asset_id] = await reference(
                asset_id,
                "audio",
                accepted_mimes=set(
                    autodl_workflows.capabilities(model_slug).reference_mime_types["audio"]
                )
                if provider_kind == "autodl_video"
                else None,
            )
        for asset_id in body.video_asset_ids:
            reference_assets[asset_id] = await reference(asset_id, "video")
        if provider_kind == "zealman_video":
            if sum(asset.byte_size for asset in reference_assets.values()) > 45 * 1024 * 1024:
                raise VisualGenerationValidationError(
                    "参考素材总大小不能超过 45 MB", code="reference_too_large"
                )
            if any(
                asset.mime_type not in WORKFLOW_MIME_TYPES[asset.media_kind]
                for asset in reference_assets.values()
            ):
                raise VisualGenerationValidationError(
                    "工作流不支持所选素材格式", code="invalid_reference"
                )
        if provider_kind == "autodl_video":
            try:
                autodl_workflows.validate_references(
                    model_slug,
                    [(a.media_kind, a.mime_type, a.byte_size) for a in reference_assets.values()],
                )
            except ValueError as exc:
                raise VisualGenerationValidationError(str(exc), code="invalid_reference") from None
        if provider_kind == "volcengine_video":
            try:
                await validate_seedance(model_slug, payload, reference_assets.values())
            except ValueError as exc:
                raise VisualGenerationValidationError(str(exc), code="invalid_reference") from None
    elif isinstance(body, AudioGenerationTaskCreateIn):
        for asset_id in body.reference_asset_ids:
            reference_assets[asset_id] = await reference(asset_id, "audio")
    if reference_titles:
        payload["reference_filenames"] = {
            asset_id: download_filename(title, reference_assets[asset_id].original_filename)
            for asset_id, title in reference_titles.items()
            if asset_id in reference_assets
        }
    return payload
