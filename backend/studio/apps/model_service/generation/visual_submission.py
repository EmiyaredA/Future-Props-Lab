"""Assemble the provider input for a Visual task through explicit media reads."""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from pathlib import Path

from studio.apps.model_service.generation.driver import ImmediateGenerationResult
from studio.apps.model_service.generation.provider_tasks import submit_generation_task
from studio.apps.model_service.providers.zealman_video import create_task, upload_reference


@dataclass(frozen=True)
class VisualGenerationInputs:
    local_reference: Callable[[str, str, str], Awaitable[tuple[Path, str]]]
    data_uri: Callable[..., Awaitable[str]]
    temporary_url: Callable[..., Awaitable[str]]


async def submit_visual_generation(
    inputs: VisualGenerationInputs,
    *,
    provider_kind: str,
    base_url: str,
    api_key: str,
    model_slug: str,
    payload: dict,
    owner_user_id: str,
) -> str | ImmediateGenerationResult:
    if provider_kind == "zealman_video":
        references: dict[str, list[str]] = {"image": [], "audio": [], "video": []}
        for kind, field in (
            ("image", "reference_asset_ids"),
            ("audio", "audio_asset_ids"),
            ("video", "video_asset_ids"),
        ):
            for asset_id in payload.get(field, []):
                path, mime_type = await inputs.local_reference(asset_id, kind, owner_user_id)
                references[kind].append(
                    await upload_reference(
                        base_url=base_url, api_key=api_key, path=path, mime_type=mime_type
                    )
                )
        return await create_task(
            base_url=base_url,
            api_key=api_key,
            model=model_slug,
            payload=payload,
            references=references,
        )
    reference_filenames = payload.get("reference_filenames")
    if not isinstance(reference_filenames, dict):
        reference_filenames = {}

    def reference_filename(asset_id: object) -> str | None:
        value = reference_filenames.get(str(asset_id))
        return value if isinstance(value, str) and value.strip() else None

    if provider_kind in {"senseaudio_music", "senseaudio_sfx"}:
        reference_urls = [
            await inputs.temporary_url(
                str(asset_id),
                "audio",
                owner_user_id,
                reference_filename(asset_id),
            )
            for asset_id in payload.get("reference_asset_ids", [])
        ]
        return await submit_generation_task(
            provider_kind=provider_kind,
            base_url=base_url,
            api_key=api_key,
            model_slug=model_slug,
            payload=payload,
            audio_reference_urls=reference_urls,
        )
    if provider_kind in {"senseaudio_image", "volcengine_image"}:
        reference_id = payload.get("reference_asset_id")
        reference = (
            await inputs.data_uri(str(reference_id), owner_user_id) if reference_id else None
        )
        return await submit_generation_task(
            provider_kind=provider_kind,
            base_url=base_url,
            api_key=api_key,
            model_slug=model_slug,
            payload=payload,
            image_reference=reference,
            image_references=[
                await inputs.data_uri(str(asset_id), owner_user_id)
                for asset_id in payload.get("reference_asset_ids", [])
            ],
        )

    content: list[dict[str, object]] = []
    if payload.get("prompt"):
        content.append({"type": "text", "text": payload["prompt"]})
    mode = payload.get("mode")
    if mode == "frames":
        content.append(
            {
                "type": "image",
                "url": await inputs.data_uri(payload["first_frame_asset_id"], owner_user_id),
                "role": "first_frame",
            }
        )
        if payload.get("last_frame_asset_id"):
            content.append(
                {
                    "type": "image",
                    "url": await inputs.data_uri(payload["last_frame_asset_id"], owner_user_id),
                    "role": "last_frame",
                }
            )
    elif mode == "reference":
        for asset_id in payload.get("reference_asset_ids", []):
            content.append(
                {
                    "type": "image",
                    "url": await inputs.data_uri(asset_id, owner_user_id),
                    "role": "reference",
                }
            )
        for asset_id in payload.get("audio_asset_ids", []):
            content.append(
                {
                    "type": "audio",
                    "audio_url": await inputs.data_uri(str(asset_id), owner_user_id)
                    if provider_kind in {"volcengine_video", "autodl_video"}
                    else await inputs.temporary_url(
                        str(asset_id),
                        "audio",
                        owner_user_id,
                        reference_filename(asset_id),
                    ),
                }
            )
        for asset_id in payload.get("video_asset_ids", []):
            content.append(
                {
                    "type": "video",
                    "video_url": await inputs.data_uri(
                        str(asset_id), owner_user_id, expected_kind="video"
                    )
                    if provider_kind == "autodl_video"
                    else await inputs.temporary_url(
                        str(asset_id),
                        "video",
                        owner_user_id,
                        reference_filename(asset_id),
                    ),
                }
            )
        # Compatibility for tasks queued before asset-ID based references were introduced.
        content.extend({"type": "audio", "audio_url": url} for url in payload.get("audio_urls", []))
        content.extend({"type": "video", "video_url": url} for url in payload.get("video_urls", []))
    return await submit_generation_task(
        provider_kind=provider_kind,
        base_url=base_url,
        api_key=api_key,
        model_slug=model_slug,
        payload=payload,
        video_content=content,
    )
