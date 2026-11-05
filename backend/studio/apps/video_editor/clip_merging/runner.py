import asyncio
import threading
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select, update

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.media_rendering.render_engine import RenderCancelled, render_document
from app.capabilities.media_rendering.video_output import verify_clip_merge_output
from studio.apps.video_editor.clip_merging.document import render_snapshot
from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata, VideoEditorTask
from studio.contracts.video_editor.timeline_document import parse_timeline_document
from studio.runtime.database.ownership import bind_owner
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


async def process_clip_merge(
    task_id: str,
    *,
    session_factory,
    settings,
    storage,
    get_task,
    set_task,
    cancel_watch,
    raise_if_cancelled,
    prepare_media,
) -> None:
    """Render and prepare files outside a write transaction, then publish once."""
    async with session_factory() as session:
        task = await get_task(session, task_id)
        if task is None:
            return
        detail = dict(task.result_detail)
        source = detail["source"]
        snapshot = render_snapshot(task.snapshot_document, source)
        document = parse_timeline_document(snapshot)
        ids = {clip["assetId"] for clip in source["clips"]}
        assets = await session.scalars(
            select(VisualAsset).where(
                VisualAsset.id.in_(ids),
                VisualAsset.video_editor_project_id == task.project_id,
                VisualAsset.owner_user_id == task.owner_user_id,
            )
        )
        paths = {asset.id: storage.path_for(asset) for asset in assets}
        if paths.keys() != ids:
            raise RuntimeError("合并源素材不存在")
        project_id, owner_user_id = task.project_id, task.owner_user_id
    cancel = threading.Event()
    watch = asyncio.create_task(cancel_watch(task_id, cancel))
    loop = asyncio.get_running_loop()

    def progress(value: int) -> None:
        asyncio.run_coroutine_threadsafe(set_task(task_id, progress=min(85, value)), loop)

    staged: Path | None = None
    derived_files: list[Path] = []
    try:
        with TemporaryDirectory(prefix=f"clip-merge-{task_id}-") as temporary:
            output = Path(temporary) / "merge.mov"
            fps = document.settings.fps
            await asyncio.to_thread(
                render_document,
                document,
                paths,
                output,
                preset=f"1080p{fps}",
                start_us=source["startUs"],
                end_us=source["startUs"] + source["durationUs"],
                cancel=cancel,
                progress=progress,
                transparent=True,
            )
            await raise_if_cancelled(task_id)
            probe = await asyncio.to_thread(
                verify_clip_merge_output, output, f"1080p{fps}", source["durationUs"]
            )
            # Prepare proxies before publishing metadata.
            probe, proxy, thumbnail, waveform, fingerprint = await asyncio.to_thread(
                prepare_media,
                output,
                task_id,
                "video",
                Path(temporary),
                probe,
            )
            await raise_if_cancelled(task_id)
            async with session_factory() as session:
                bind_owner(session, owner_user_id)
                asset, staged = await AssetLibrary(session, settings).stage_local_copy(
                    output,
                    owner_user_id=owner_user_id,
                    filename=f"{detail['name'][:200]}-{task_id[:8]}.mov",
                    content_type="video/quicktime",
                    video_editor_project_id=project_id,
                    allowed_extensions={".mov"},
                    max_bytes=settings.fpl_galgame_export_max_bytes,
                    defer_persistence=True,
                )
                # Finish large file I/O before starting the publishing transaction.
                asset.id = new_id()
                derived = (
                    storage.project_root("video-editor", project_id, owner_user_id=owner_user_id)
                    / "derived"
                )
                derived.mkdir(parents=True, exist_ok=True)
                for filename in (proxy, thumbnail, waveform):
                    if filename:
                        target = derived / filename
                        await asyncio.to_thread((Path(temporary) / filename).replace, target)
                        derived_files.append(target)
                task = await get_task(session, task_id)
                if task is None or task.cancel_requested:
                    raise RenderCancelled()
                session.add(asset)
                await session.flush()
                session.add(
                    VideoEditorAssetMetadata(
                        asset_id=asset.id,
                        project_id=project_id,
                        processing_status="ready",
                        probe=probe,
                        proxy_filename=proxy,
                        thumbnail_filename=thumbnail,
                        waveform_filename=waveform,
                        fingerprint=fingerprint,
                    )
                )
                await session.flush()
                changed = await session.execute(
                    update(VideoEditorTask)
                    .where(
                        VideoEditorTask.id == task_id,
                        VideoEditorTask.status == "running",
                        VideoEditorTask.cancel_requested.is_(False),
                        VideoEditorTask.revision == task.revision,
                    )
                    .values(
                        output_asset_id=asset.id,
                        result_detail={**detail, "probe": probe},
                        status="completed",
                        progress=100,
                        revision=task.revision + 1,
                        finished_at=utc_now(),
                        updated_at=utc_now(),
                    )
                )
                if changed.rowcount != 1:
                    raise RenderCancelled()
                await session.commit()
                staged = None
                derived_files.clear()
    finally:
        watch.cancel()
        await asyncio.gather(watch, return_exceptions=True)
        if staged:
            staged.unlink(missing_ok=True)
        for path in derived_files:
            path.unlink(missing_ok=True)
