import asyncio
from uuid import uuid4

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION, AssetStorage
from app.capabilities.media_rendering.inspection import inspect_media
from app.capabilities.media_rendering.review_images import review_jpeg
from app.capabilities.media_rendering.video_frames import extract_frame
from app.capabilities.media_rendering.video_sampling import source_frame_time
from studio.apps.visual_workshop.acceptance.access import asset
from studio.apps.visual_workshop.acceptance.models import AcceptanceAssetReference
from studio.contracts.agent_runtime.dialogue import ImageInput
from studio.runtime.ids import new_id


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

    data = await asyncio.to_thread(review_jpeg, storage.path_for(row))
    return ImageInput(
        mime_type="image/jpeg", data_base64=base64.b64encode(data).decode(), byte_size=len(data)
    )


async def flush_evidence(session):
    # These are independent mappers: insert parent assets before restrictive refs.
    pending = [row for row in session.new if isinstance(row, VisualAsset)]
    if pending:
        await session.flush(pending)
    await session.flush()


async def metadata(session, settings, run):
    output = run.snapshot["output"]
    if output["kind"] not in {"image", "video"}:
        return {}
    row = await asset(session, run.owner_user_id, run.project_id, output["asset_id"])
    return await inspect_media(AssetStorage(settings).path_for(row), output["kind"])
