from __future__ import annotations

import asyncio

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.apps.video_editor.models import VideoEditorProject, VideoEditorTask
from app.apps.video_editor.runner import VideoEditorRunner
from app.runtime.db import SessionLocal


@pytest_asyncio.fixture(autouse=True)
async def isolated_queue():
    yield
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        await session.commit()


async def _tasks(status: str = "queued") -> tuple[str, str]:
    # Runner storage fixtures live only in conftest's isolated temporary database.
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        project = VideoEditorProject(title="预处理与导出调度", workspace_id="default")
        session.add(project)
        await session.flush()
        render = VideoEditorTask(
            project_id=project.id,
            workspace_id="default",
            request_id="render",
            kind="render",
            status=status,
            request_payload={},
        )
        media = VideoEditorTask(
            project_id=project.id,
            workspace_id="default",
            request_id="media",
            kind="media",
            status=status,
            request_payload={"assetId": "fixture"},
        )
        session.add_all([render, media])
        await session.commit()
        return render.id, media.id


@pytest.mark.asyncio
async def test_media_completes_while_export_is_still_running(monkeypatch) -> None:
    render_id, media_id = await _tasks()
    exporting = asyncio.Event()
    finish_export = asyncio.Event()
    export_runner = VideoEditorRunner()
    media_runner = VideoEditorRunner(lane="media")

    async def slow_export(task_id: str) -> None:
        assert task_id == render_id
        exporting.set()
        await finish_export.wait()
        await export_runner._set(task_id, status="completed", finished=True)

    async def prepare_media(task_id: str) -> None:
        assert task_id == media_id
        await media_runner._set(task_id, status="completed", finished=True)

    monkeypatch.setattr(export_runner, "_process_render", slow_export)
    monkeypatch.setattr(media_runner, "_process_media", prepare_media)
    running = asyncio.create_task(export_runner.process_once())
    try:
        await asyncio.wait_for(exporting.wait(), timeout=2)
        await asyncio.wait_for(media_runner.process_once(), timeout=2)
        assert not running.done()
        async with SessionLocal() as session:
            assert (await session.get(VideoEditorTask, render_id)).status == "running"
            assert (await session.get(VideoEditorTask, media_id)).status == "completed"
        assert export_runner.runner_name != media_runner.runner_name
    finally:
        finish_export.set()
        await running


@pytest.mark.asyncio
@pytest.mark.parametrize("lane", ["media", "export"])
async def test_lane_recovery_does_not_requeue_the_other_running_lane(lane: str) -> None:
    render_id, media_id = await _tasks("running")
    await VideoEditorRunner(lane=lane).recover()
    async with SessionLocal() as session:
        render = await session.get(VideoEditorTask, render_id)
        media = await session.get(VideoEditorTask, media_id)
        assert render.status == ("queued" if lane == "export" else "running")
        assert media.status == ("queued" if lane == "media" else "running")


@pytest.mark.asyncio
async def test_export_poll_leaves_a_media_only_queue_untouched() -> None:
    render_id, media_id = await _tasks("running")
    async with SessionLocal() as session:
        media = await session.get(VideoEditorTask, media_id)
        media.status = "queued"
        await session.commit()
    await VideoEditorRunner().process_once()
    async with SessionLocal() as session:
        assert (await session.get(VideoEditorTask, media_id)).status == "queued"
        assert (await session.get(VideoEditorTask, render_id)).status == "running"
