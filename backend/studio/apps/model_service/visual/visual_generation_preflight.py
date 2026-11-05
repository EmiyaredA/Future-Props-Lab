"""Validate and stage the exact owner inputs before a provider batch can be queued."""

import shutil

import httpx

from app.capabilities.asset_store.policy import REFERENCE_IMAGE_MIME_TYPES
from app.llm.providers.seedance_references import SeedanceReference, validate_seedance_references
from app.llm.visual_generation_model import VisualGenerationValidationError, select_visual_model
from app.llm.visual_generation_payload import prepare_visual_payload
from studio.contracts.identity.claims import HEADER
from studio.contracts.visual_workshop.visual_generation import VisualModelChoice
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.http.framed_media import SIZE, FramedInputs

REFERENCE_MIME_TYPES = {
    "image": REFERENCE_IMAGE_MIME_TYPES,
    "audio": {"audio/mpeg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/x-m4a", "audio/ogg"},
    "video": {"video/mp4", "video/quicktime", "video/webm"},
}


async def original_files(state, plan, token, directory):
    if plan.scope is None:
        return {}
    scope = plan.scope
    sizes = {item.id: item.byte_size for item in plan.assets.items}
    total = sum(SIZE.size + size for size in sizes.values())
    if total > shutil.disk_usage(directory).free:
        raise VisualGenerationValidationError(
            "模型参考素材暂存空间不足", code="visual_generation_staging_full", status=507
        )
    path = scope.path(plan.project_id, str(plan.plan_id))
    try:
        async with state.capabilities.client.stream(
            "POST",
            "http://assets:8080" + path,
            headers={HEADER: token, "Accept-Encoding": "identity"},
            json=scope.model_dump(mode="json"),
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in (401, 403):
                raise VisualGenerationValidationError(
                    "模型素材授权已结束",
                    code="visual_generation_authority_ended",
                    status=response.status_code,
                )
            if response.status_code in (404, 409):
                raise VisualGenerationValidationError(
                    "生成参考素材已变化", code="visual_generation_source_changed", status=409
                )
            response.raise_for_status()
            if (
                response.headers.get("Content-Encoding", "identity") != "identity"
                or response.headers.get("Content-Type") != "application/octet-stream"
                or int(response.headers["Content-Length"]) != total
            ):
                raise ValueError("invalid generation originals response")
            framed = FramedInputs(response.aiter_bytes(1024 * 1024))
            paths = {}
            for entry in scope.files:
                size = SIZE.unpack(await framed.read(SIZE.size))[0]
                if size != sizes[entry.id]:
                    raise ValueError("generation original size changed")
                destination = directory / entry.id
                with destination.open("xb") as target:
                    await framed.transfer(target, size)
                paths[entry.id] = destination
            await framed.require_end(total)
            return paths
    except (CapabilityUnavailable, httpx.HTTPError, KeyError, OSError, ValueError) as exc:
        raise VisualGenerationValidationError(
            "生成参考素材暂不可用", code="visual_generation_source_unavailable", status=503
        ) from exc


async def verify_selection(session, state, owner, plan):
    choice = plan.model
    args = plan.tasks[0].arguments
    model, provider = await select_visual_model(
        session, owner, choice.model_id, args.kind, args.mode if args.kind == "audio" else None
    )
    current = VisualModelChoice(
        model_id=model.id,
        provider_id=provider.id,
        provider_kind=provider.kind,
        provider_name=provider.name,
        model_slug=model.slug,
        temporary_upload_configured=bool(state.settings.fpl_temp_media_upload_url),
    )
    if current != choice:
        raise VisualGenerationValidationError(
            "生成模型配置已变化，请刷新后重试", code="model_unavailable", status=409
        )


def reference_rules(asset, kind, mimes, limit):
    label = {"image": "参考图片", "audio": "参考音频", "video": "参考视频"}[kind]
    if asset is None:
        raise VisualGenerationValidationError(
            f"{label}不存在", code="invalid_reference", status=404
        )
    if asset.media_kind != kind or asset.mime_type not in mimes:
        raise VisualGenerationValidationError(f"{label}格式不受支持", code="invalid_reference")
    if asset.byte_size > limit:
        message = {
            "image": "单张参考图片不能超过 30 MB",
            "audio": "单个参考音频不能超过 15 MB",
            "video": "单个参考视频超过项目文件上限",
        }[kind]
        raise VisualGenerationValidationError(message, code="reference_too_large")
    return asset


async def normalize(state, plan, paths):
    assets = {item.id: item for item in plan.assets.items}
    limits = {"image": 30 * 1024**2, "audio": 15 * 1024**2, "video": plan.assets.max_video_bytes}

    async def reference(identity, kind, *, accepted_mimes=None):
        return reference_rules(
            assets.get(identity), kind, accepted_mimes or REFERENCE_MIME_TYPES[kind], limits[kind]
        )

    async def seedance(slug, payload, files):
        await validate_seedance_references(
            slug,
            payload,
            [
                SeedanceReference(asset.media_kind, asset.mime_type, paths[asset.id])
                for asset in files
            ],
            state.settings.fpl_temp_media_upload_url,
        )

    return {
        str(task.task_id): await prepare_visual_payload(
            task.arguments,
            provider_kind=plan.model.provider_kind,
            model_slug=plan.model.model_slug,
            explicit_fields=set(task.explicit_fields),
            reference_titles=task.reference_titles,
            input_snapshot=task.input_snapshot,
            reference=reference,
            validate_seedance=seedance,
        )
        for task in plan.tasks
    }
