import asyncio
from uuid import uuid4

from PIL import Image

from app.apps.visual_workshop.acceptance.models import AcceptanceAssetReference
from app.capabilities.agents.harness.contracts import ImageInput
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.capabilities.media_rendering.inspection import inspect_media
from app.capabilities.media_rendering.video_frames import extract_frame
from app.capabilities.media_rendering.video_sampling import source_frame_time
from app.runtime.ids import new_id

from .access import asset
from .project_access import AcceptanceError


def positions(duration_ms, start=0, end=None):
    end = min(duration_ms - 1, end if end is not None else duration_ms - 1)
    if not 0 <= start <= end:
        raise AcceptanceError("取样区间无效")
    return sorted({round(start + (end - start) * index / 11) for index in range(12)})


async def extract_evidence(session, settings, run, source_id, times):
    source = await asset(session, run.owner_user_id, run.project_id, source_id)
    storage = AssetStorage(settings)
    source_path = storage.path_for(source)
    evidence, written, seen = [], [], set()
    try:
        for position in times:
            actual = await asyncio.to_thread(source_frame_time, source_path, position * 1000)
            position = int(actual * 1000)
            if position in seen:
                continue
            seen.add(position)
            key = uuid4().hex + ".png"
            path = storage.target_path(
                key,
                visual_project_id=run.project_id,
                galgame_project_id=None,
                owner_user_id=run.owner_user_id,
            )
            path.parent.mkdir(parents=True, exist_ok=True)
            written.append(path)
            await extract_frame(source_path, path, position, 1024)
            identity = new_id()
            session.add(
                VisualAsset(
                    id=identity,
                    owner_user_id=run.owner_user_id,
                    project_id=run.project_id,
                    original_filename=f"frame-{position}ms.png",
                    display_name=f"验收取样 {position} ms",
                    storage_key=key,
                    storage_version=TARGET_STORAGE_VERSION,
                    media_kind="image",
                    mime_type="image/png",
                    byte_size=path.stat().st_size,
                )
            )
            session.add(
                AcceptanceAssetReference(
                    owner_id=run.id, project_id=run.project_id, asset_id=identity
                )
            )
            evidence.append(
                {
                    "id": new_id(),
                    "asset_id": identity,
                    "source_asset_id": source_id,
                    "position_ms": position,
                }
            )
        return evidence, written
    except BaseException:
        for path in written:
            path.unlink(missing_ok=True)
        raise


async def image_input(storage, row):
    import base64
    from io import BytesIO

    def encode():
        with Image.open(storage.path_for(row)) as image:
            image.thumbnail((1024, 1024))
            image = image.convert("RGB")
            result = BytesIO()
            image.save(result, format="JPEG", quality=85)
            data = result.getvalue()
        return ImageInput(
            mime_type="image/jpeg", data_base64=base64.b64encode(data).decode(), byte_size=len(data)
        )

    return await asyncio.to_thread(encode)


async def flush_evidence(session):
    # These are independent mappers: insert parent assets before restrictive refs.
    pending = [row for row in session.new if isinstance(row, VisualAsset)]
    if pending:
        await session.flush(pending)
    await session.flush()


def check_specifications(metadata, config):
    failures = []
    for name, field in (("宽度", "width"), ("高度", "height")):
        target = config.get("min_" + field)
        if target and metadata[field] < target:
            failures.append(f"{name}小于 {target}")
    if config.get("ratio"):
        width, height = map(int, config["ratio"].split(":"))
        if abs(metadata["width"] / metadata["height"] - width / height) > 0.02:
            failures.append("画幅不符合要求")
    duration = metadata.get("duration_ms", 0) / 1000
    if config.get("min_duration") is not None and duration < config["min_duration"]:
        failures.append("时长不足")
    if config.get("max_duration") is not None and duration > config["max_duration"]:
        failures.append("时长过长")
    if config.get("require_audio") and not metadata.get("has_audio"):
        failures.append("缺少音轨")
    return (
        ("failed", "；".join(failures))
        if failures
        else ("passed", "文件可解码，已启用的规格条件均满足。")
    )


async def metadata(session, settings, run):
    output = run.snapshot["output"]
    if output["kind"] not in {"image", "video"}:
        return {}
    row = await asset(session, run.owner_user_id, run.project_id, output["asset_id"])
    return await inspect_media(AssetStorage(settings).path_for(row), output["kind"])
