"""Website preview publication and retryable cleanup of retired caches."""

from pathlib import Path
from shutil import rmtree

from sqlalchemy import select, text

from studio.apps.media_rendering.local.render_engine import RenderCancelled
from studio.apps.video_editor.preview_renders import retire_previous_previews
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.runtime.database.ownership import bind_owner
from studio.runtime.tasks.blocking_io import run_blocking_io
from studio.runtime.time import utc_now


def local_preview_path(storage, owner, project, task):
    root = storage.project_root("video-editor", project, owner_user_id=owner)
    return root / "derived" / "previews" / f"{task}.mp4"


async def prepare_local_preview(sessions, storage, task_id, owner, project):
    # Project deletion also reclaims interrupted encodes. A resumed task removes
    # only its own old staging before opening any decoder.
    staging = local_preview_path(storage, owner, project, task_id).parent / "staging" / task_id
    if staging.exists():
        await run_blocking_io(rmtree, staging)
    async with sessions() as session:
        bind_owner(session, owner)
        await session.execute(text("BEGIN IMMEDIATE"))
        task = await session.get(VideoEditorTask, task_id)
        if task is None or task.cancel_requested:
            raise RenderCancelled()
        staging.mkdir(parents=True, exist_ok=True)
        await session.commit()
    return staging


async def publish_local_preview(
    sessions, storage, task_id, owner, project, output: Path, probe, allowed
):
    async with sessions() as session:
        bind_owner(session, owner)
        await session.execute(text("BEGIN IMMEDIATE"))
        task = await session.get(VideoEditorTask, task_id)
        if (
            task is None
            or task.cancel_requested
            or task.result_detail.get("retired")
            or not await allowed(session, owner)
        ):
            raise RenderCancelled()
        target = local_preview_path(storage, owner, project, task_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        # The file is small metadata work here: bytes were rendered in staging.
        output.replace(target)
        task.result_detail = {**task.result_detail, "probe": probe}
        task.status, task.progress = "completed", 100
        task.finished_at = task.updated_at = utc_now()
        task.revision += 1
        await retire_previous_previews(session, task)
        # Preserve the file on an unknown commit. Recovery overwrites the same
        # task path or the retired-task sweep removes it.
        await session.commit()


async def cleanup_local_preview(sessions, storage):
    async with sessions() as session:
        row = await session.scalar(
            select(VideoEditorTask)
            .where(
                VideoEditorTask.kind == "preview_render",
                VideoEditorTask.result_detail["retired"].as_boolean().is_(True),
                VideoEditorTask.status.not_in(("running",)),
            )
            .order_by(VideoEditorTask.updated_at, VideoEditorTask.id)
            .limit(1)
        )
        if row is None:
            return
        owner, project, task_id = row.owner_user_id, row.project_id, row.id
        bind_owner(session, owner)
        await session.rollback()
        path = local_preview_path(storage, owner, project, task_id)
        try:
            await run_blocking_io(path.unlink, missing_ok=True)
            staging = path.parent / "staging" / task_id
            if staging.exists():
                await run_blocking_io(rmtree, staging)
        except OSError:
            # Rotate a failed cleanup without blocking the export lane. Keeping
            # the retired row is the durable retry intent.
            row = await session.get(VideoEditorTask, task_id)
            if row is not None:
                row.updated_at = utc_now()
                await session.commit()
            return
        row = await session.get(VideoEditorTask, task_id)
        if row is not None:
            await session.delete(row)
            await session.commit()
