"""Local video segment and durable recovery tests with isolated media and storage."""

import asyncio
import json
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from studio.apps.model_service.storage.models.model_inference import ModelInferenceAsset
from studio.apps.model_service.storage.models.video_enhancement import VideoEnhancementTask
from studio.apps.model_service.video_enhancement import media
from studio.apps.model_service.video_enhancement.tasks import VideoBackend, VideoEnhancement
from studio.contracts.model_service.schemas.video_enhancement import (
    VideoEnhancementAction,
    VideoEnhancementIn,
)
from studio.contracts.model_service.video_runtime import VideoMemoryError
from studio.runtime.operation_errors import OperationError


def test_scene_boundaries_and_retry_windows():
    parts = media.segments(120, [50, 0, 120, 50])
    assert [(left, right) for left, right, *_ in parts] == [(0, 48), (48, 50), (50, 98), (98, 120)]
    assert list(media.windows(parts[2])) == [(50, 98, 50, 106)]
    assert list(media.windows(parts[2], reduced=True)) == [
        (50, 66, 50, 74),
        (66, 82, 58, 90),
        (82, 98, 74, 106),
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize("fast", [False, True])
async def test_ffmpeg_sections_and_audio(tmp_path, monkeypatch, fast):
    if fast:
        command = media.command

        async def software_encoder(*args):
            # Test filters, seeking and muxing even on hosts without VideoToolbox.
            args = list(args)
            while "h264_videotoolbox" in args:
                index = args.index("h264_videotoolbox")
                args[index : index + 3] = ["libx264", "-preset", "ultrafast"]
            return await command(*args)

        monkeypatch.setattr(media, "command", software_encoder)
    source = tmp_path / "source.mp4"
    await media.command(
        "ffmpeg",
        "-nostdin",
        "-v",
        "error",
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=64x36:rate=24000/1001:duration=3",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:duration=3",
        "-c:v",
        "libx264",
        "-c:a",
        "aac",
        "-shortest",
        source,
    )
    video = await media.probe(source)
    assert video.fps == "24000/1001"
    assert video.output_size == (1920, 1080)
    parts = []
    for index, segment in enumerate(media.segments(video.frames, [])):
        first, last, *_scene = segment
        if fast:
            folder = tmp_path / f"part-{index}"
            folder.mkdir()
            await media.fast_segment(source, video, segment, folder)
            target = folder / "enhanced.mp4"
        else:
            raw = tmp_path / "input.rgb"
            target = tmp_path / f"part-{index}.mp4"
            await media.extract(source, video, first, last, raw)
            await media.encode(raw, source, video, first, last, 1, target)
            await media.verify(target, video, last - first)
        parts.append((target, last - first))
    result = tmp_path / "result.mp4"
    await media.combine(parts, source, video, result, tmp_path)
    await media.verify(result, video, video.frames)
    out, _ = await media.command(
        "ffprobe", "-v", "error", "-show_streams", "-show_format", "-of", "json", result
    )
    streams = json.loads(out)["streams"]
    assert [(s["codec_type"], s["codec_name"]) for s in streams] == [
        ("video", "h264"),
        ("audio", "aac"),
    ]
    assert abs(float(streams[0]["duration"]) - float(streams[1]["duration"])) < 0.05


@pytest.mark.asyncio
async def test_task_pause_restart_retry_delivery(tmp_path, monkeypatch):
    db = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'isolated.sqlite'}")
    async with db.begin() as connection:
        await connection.run_sync(ModelInferenceAsset.__table__.create)
        await connection.run_sync(VideoEnhancementTask.__table__.create)
    sessions = async_sessionmaker(db, expire_on_commit=False)
    owner = "fixture-owner"
    settings = SimpleNamespace(runtime_path=tmp_path)
    calls = []
    second_segment = asyncio.Event()
    blocked = True
    combine_fails = True

    async def active(_session, _owner):
        return True

    async def attached(*_args):
        return backend

    async def probe(_source):
        return media.Video(64, 36, "24", 130, 0, None)

    async def plan(_source, video, *, core_frames):
        return media.segments(video.frames, [], core_frames=core_frames)

    async def process(_source, _video, segment, scratch, _runtime, *, reduced=False):
        calls.append((segment[0], reduced))
        if segment[0] == 48 and blocked:
            second_segment.set()
            await asyncio.Future()
        if segment[0] == 96 and not reduced:
            raise VideoMemoryError("simulated OOM")
        for name in ("original", "enhanced"):
            (scratch / f"{name}.mp4").write_bytes(b"checkpoint")

    async def combine(_parts, _source, _video, target, _scratch):
        if combine_fails:
            raise media.MediaError("合成测试失败")
        target.write_bytes(b"complete")

    async def verify(*_args):
        return None

    async def close():
        return None

    monkeypatch.setattr(media, "probe", probe)
    monkeypatch.setattr(media, "plan", plan)
    monkeypatch.setattr(media, "combine", combine)
    monkeypatch.setattr(media, "verify", verify)
    monkeypatch.setattr(VideoEnhancement, "attached", attached)
    monkeypatch.setattr(VideoEnhancement, "process_segment", staticmethod(process))

    async def engine(_scratch):
        return SimpleNamespace(close=close)

    backend = VideoBackend("local_relayvsr", "fixture", lambda: True, engine)

    def manager():
        return VideoEnhancement(
            sessions,
            settings,
            {"relayvsr-x2-int8": backend},
            owner_active=active,
        )

    service = manager()
    reopened = None
    try:
        source = service.storage.root(owner) / "inputs" / "source"
        source.parent.mkdir(parents=True)
        source.write_bytes(b"fixture")
        async with sessions() as session:
            asset = ModelInferenceAsset(
                owner_user_id=owner,
                storage_key=source.name,
                filename="source.mp4",
                mime_type="video/mp4",
                media_kind="video",
                byte_size=7,
            )
            session.add(asset)
            await session.commit()
        body = VideoEnhancementIn(request_id="replay", model_id="model", source_id=asset.id)
        task = await service.create(owner, body)
        assert (await service.create(owner, body)).id == task.id
        await asyncio.wait_for(second_segment.wait(), 5)
        task = await service.detail(owner, task.id)
        assert task.status == "running" and task.completed == 1
        assert task.segments[0].original_url and task.segments[0].result_url
        assert (await service.content(owner, task.id, 0, "enhanced")).read_bytes() == b"checkpoint"
        with pytest.raises(OperationError, match="任务不存在"):
            await service.content("other-account", task.id, 0, "enhanced")
        await service.action(
            owner, task.id, VideoEnhancementAction(action="pause", expected_revision=task.revision)
        )
        await asyncio.wait_for(asyncio.shield(service.runner), 5)
        task = await service.detail(owner, task.id)
        assert task.status == "paused" and task.completed == 1
        second_segment.clear()
        await service.action(
            owner, task.id, VideoEnhancementAction(action="resume", expected_revision=task.revision)
        )
        await asyncio.wait_for(second_segment.wait(), 5)
        await service.close()
        task = await service.detail(owner, task.id)
        assert task.status == "interrupted" and task.completed == 1

        reopened = manager()
        await reopened.recover()
        blocked = False
        await reopened.action(
            owner, task.id, VideoEnhancementAction(action="resume", expected_revision=task.revision)
        )
        await asyncio.wait_for(asyncio.shield(reopened.runner), 5)
        task = await reopened.detail(owner, task.id)
        assert task.status == "failed" and task.completed == 3
        assert calls == [(0, False), (48, False), (48, False), (48, False), (96, False), (96, True)]

        combine_fails = False
        await reopened.action(
            owner, task.id, VideoEnhancementAction(action="resume", expected_revision=task.revision)
        )
        await asyncio.wait_for(asyncio.shield(reopened.runner), 5)
        task = await reopened.detail(owner, task.id)
        assert task.status == "completed" and task.result_url
        assert (await reopened.content(owner, task.id)).read_bytes() == b"complete"
        assert len(calls) == 6
    finally:
        await service.close()
        if reopened:
            await reopened.close()
        await db.dispose()


@pytest.mark.asyncio
async def test_video_routes_use_local_session_and_support_range_requests(tmp_path):
    from pathlib import Path

    import httpx
    from fastapi import FastAPI, Request

    from studio.apps.model_service.transport.website.video_enhancement import router
    from studio.assembly.http_dependencies import require_studio_auth

    file = tmp_path / "fixture.mp4"
    file.write_bytes(b"0123456789")
    principal = SimpleNamespace(user_id="me", auth_kind="session")
    app = FastAPI()
    app.include_router(router, prefix="/v1")
    app.dependency_overrides[require_studio_auth] = lambda: principal

    @app.middleware("http")
    async def local_scope(request: Request, call_next):
        request.state.website_local = request.url.hostname == "local.test"
        return await call_next(request)

    async def content(owner, task, index, variant) -> Path:
        assert (owner, task, index, variant) == ("me", "test", 0, "original")
        return file

    app.state.video_enhancement = SimpleNamespace(content=content)
    transport = httpx.ASGITransport(app=app)
    route = "/v1/model-inference/video-enhancements/test/segments/0/original"
    async with httpx.AsyncClient(transport=transport) as client:
        denied = await client.get("http://remote.test" + route)
        assert denied.status_code == 403
        media_response = await client.get(
            "http://local.test" + route, headers={"Range": "bytes=2-4"}
        )
        assert media_response.status_code == 206 and media_response.content == b"234"
        assert media_response.headers["cache-control"] == "private, no-store"
        principal.auth_kind = "api_key"
        denied = await client.get("http://local.test" + route)
        assert denied.status_code == 403
