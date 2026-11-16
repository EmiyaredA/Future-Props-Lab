"""Preview caches remain disposable, version-bound and absent from user assets."""

from pathlib import Path

import httpx
import pytest
from sqlalchemy import delete, select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.identity.storage.models.accounts import User
from studio.apps.identity.website_access.video_preview import preview_actor_allowed
from studio.apps.video_editor.errors import VideoEditorNotFoundError
from studio.apps.video_editor.preview_renders import PreviewRenders
from studio.apps.video_editor.preview_storage import local_preview_path
from studio.apps.video_editor.storage.models import VideoEditorProject, VideoEditorTask
from studio.assembly.website.video_editor.runner import VideoEditorRunner
from studio.config.settings import get_settings
from tests.apps.video_editor.test_video_editor import color_clip
from website_test_support import SessionLocal, app


@pytest.fixture
async def preview_project():
    async with SessionLocal() as session:
        await session.execute(delete(VideoEditorProject))
        user = await session.get(User, "test-user")
        user.must_change_password = False
        await session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post("/v1/video-editor/projects", json={"title": "Preview"})
        assert created.status_code == 200, created.text
        project = created.json()["id"]
        base = f"/v1/video-editor/projects/{project}"
        edited = await client.post(
            base + "/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": "preview-seed",
                "operations": [
                    {"type": "updateSettings", "patch": {"fps": 60}},
                    {"type": "addClip", "clip": color_clip("preview-color", 0, 100_000)},
                ],
            },
        )
        assert edited.status_code == 200, edited.text
        yield client, base, project
        await client.delete(base, params={"expected_revision": 0})


@pytest.mark.asyncio
async def test_preview_render_reuses_snapshot_streams_range_and_invalidates(preview_project):
    client, base, project = preview_project
    route = base + "/preview/renders"
    body = {"expectedRevision": 1, "requestId": "preview-first"}
    created = await client.post(route, json=body)
    assert created.status_code == 200, created.text
    task = created.json()
    assert task["kind"] == "preview_render" and task["resultDetail"]["preset"] == "720p60"
    assert not task["valid"] and task["mediaUrl"] is None
    repeat = await client.post(route, json={**body, "requestId": "preview-repeat"})
    assert repeat.json()["id"] == task["id"]
    staging = (
        local_preview_path(AssetStorage(get_settings()), "test-user", project, task["id"]).parent
        / "staging"
        / task["id"]
    )
    staging.mkdir(parents=True, exist_ok=True)
    (staging / "interrupted.mp4").write_bytes(b"isolated interrupted encode")
    runner = VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), preview_allowed=preview_actor_allowed
    )
    await runner.process_once()
    completed = (await client.get(route)).json()["items"][0]
    assert completed["status"] == "completed", completed
    assert not (staging / "interrupted.mp4").exists()
    assert completed["valid"] and completed["outputAssetId"] is None
    movie = await client.get(completed["mediaUrl"], headers={"Range": "bytes=0-31"})
    assert movie.status_code == 206, movie.text
    assert len(movie.content) == 32 and b"ftyp" in movie.content[:16]
    assert movie.headers["content-range"].startswith("bytes 0-31/")
    assert (await client.get(base + "/assets")).json()["items"] == []
    assert (await client.get(base + "/renders")).json()["items"] == []
    stale = await client.post(route, json={**body, "expectedRevision": 0})
    assert stale.status_code == 409
    changed = await client.post(
        base + "/timeline/operations",
        json={
            "expectedRevision": 1,
            "requestId": "preview-change",
            "operations": [
                {"type": "updateClip", "clipId": "preview-color", "patch": {"color": "#ff0000"}}
            ],
        },
    )
    assert changed.status_code == 200, changed.text
    assert not (await client.get(route)).json()["items"][0]["valid"]
    assert (await client.get(completed["mediaUrl"])).status_code == 404
    newer = await client.post(route, json={"expectedRevision": 2, "requestId": "preview-newer"})
    assert newer.status_code == 200, newer.text
    await runner.process_once()
    await runner.process_once()
    items = (await client.get(route)).json()["items"]
    assert len(items) == 1 and items[0]["valid"]
    original = local_preview_path(AssetStorage(get_settings()), "test-user", project, task["id"])
    assert not original.exists()
    assert (await client.delete(route)).status_code == 200
    assert (await client.get(route)).json()["items"] == []
    await runner.process_once()
    newest = local_preview_path(
        AssetStorage(get_settings()), "test-user", project, newer.json()["id"]
    )
    assert not newest.exists()


@pytest.mark.asyncio
async def test_preview_cancel_before_execution_and_recovery(preview_project):
    client, base, _project = preview_project
    route = base + "/preview/renders"
    first = (
        await client.post(route, json={"expectedRevision": 1, "requestId": "preview-cancel"})
    ).json()
    assert (await client.post(route + f"/{first['id']}/cancel")).status_code == 200
    runner = VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), preview_allowed=preview_actor_allowed
    )
    await runner.process_once()
    assert (await client.get(route)).json()["items"][0]["status"] == "cancelled"
    second = await client.post(route, json={"expectedRevision": 1, "requestId": "preview-retry"})
    assert second.status_code == 200, second.text
    async with SessionLocal() as session:
        task = await session.get(VideoEditorTask, second.json()["id"])
        task.status = "running"
        task.cancel_requested = True
        await session.commit()
    await runner.recover()
    assert (await client.get(route)).json()["items"][0]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_preview_running_snapshot_cannot_be_replaced_and_clear_retries(
    preview_project, monkeypatch
):
    client, base, project = preview_project
    route = base + "/preview/renders"
    task = (
        await client.post(route, json={"expectedRevision": 1, "requestId": "preview-active"})
    ).json()
    await client.post(
        base + "/timeline/operations",
        json={
            "expectedRevision": 1,
            "requestId": "preview-while-active",
            "operations": [{"type": "updateSettings", "patch": {"fps": 30}}],
        },
    )
    conflict = await client.post(
        route, json={"expectedRevision": 2, "requestId": "preview-conflict"}
    )
    assert conflict.status_code == 422 and conflict.json()["code"] == "preview_active"
    await client.delete(route)
    path = local_preview_path(AssetStorage(get_settings()), "test-user", project, task["id"])
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"isolated stale preview")
    runner = VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), preview_allowed=preview_actor_allowed
    )
    unlink = Path.unlink

    def fail_once(target, *args, **kwargs):
        if target == path:
            raise OSError("isolated cleanup failure")
        return unlink(target, *args, **kwargs)

    with monkeypatch.context() as fault:
        fault.setattr(Path, "unlink", fail_once)
        await runner.process_once()
    assert path.exists()
    await runner.process_once()
    assert not path.exists()
    async with SessionLocal() as session:
        assert (
            await session.scalar(select(VideoEditorTask).where(VideoEditorTask.id == task["id"]))
            is None
        )


@pytest.mark.asyncio
async def test_preview_concurrent_submit_missing_file_and_account_revocation(preview_project):
    import asyncio

    client, base, project = preview_project
    route = base + "/preview/renders"
    responses = await asyncio.gather(
        *(
            client.post(route, json={"expectedRevision": 1, "requestId": f"concurrent-{i}"})
            for i in range(3)
        )
    )
    assert all(response.status_code == 200 for response in responses)
    assert len({response.json()["id"] for response in responses}) == 1
    async with SessionLocal() as session:
        with pytest.raises(VideoEditorNotFoundError):
            await PreviewRenders(session, "other-account", remote=False).list(project)
    runner = VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), preview_allowed=preview_actor_allowed
    )
    await runner.process_once()
    status = (await client.get(route)).json()["items"][0]
    assert status["valid"]
    path = local_preview_path(AssetStorage(get_settings()), "test-user", project, status["id"])
    path.unlink()
    assert (await client.get(status["mediaUrl"])).status_code == 404
    await client.delete(route)
    await runner.process_once()
    await client.post(route, json={"expectedRevision": 1, "requestId": "revoked-preview"})
    async with SessionLocal() as session:
        user = await session.get(User, "test-user")
        user.must_change_password = True
        await session.commit()
    await runner.process_once()
    assert (await client.get(route)).json()["items"][0]["status"] == "cancelled"


@pytest.mark.asyncio
async def test_preview_asset_revision_change_invalidates_without_timeline_edit(preview_project):
    from io import BytesIO

    from PIL import Image

    from studio.apps.video_editor.storage.models import VideoEditorAssetMetadata

    client, base, _project = preview_project
    image = BytesIO()
    Image.new("RGB", (8, 8), "teal").save(image, format="PNG")
    uploaded = await client.post(
        base + "/assets", files={"upload": ("image.png", image.getvalue(), "image/png")}
    )
    assert uploaded.status_code == 200, uploaded.text
    asset_id = uploaded.json()["id"]
    await VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), lane="media"
    ).process_once()
    added = await client.post(
        base + "/timeline/operations",
        json={
            "expectedRevision": 1,
            "requestId": "preview-image",
            "operations": [
                {
                    "type": "addClip",
                    "clip": {
                        "id": "image",
                        "name": "Image",
                        "kind": "image",
                        "trackId": "mixed-1",
                        "assetId": asset_id,
                        "timelineStartUs": 0,
                        "durationUs": 100_000,
                    },
                }
            ],
        },
    )
    assert added.status_code == 200, added.text
    route = base + "/preview/renders"
    await client.post(route, json={"expectedRevision": 2, "requestId": "preview-image-render"})
    await VideoEditorRunner(
        session_factory=SessionLocal, settings=get_settings(), preview_allowed=preview_actor_allowed
    ).process_once()
    assert (await client.get(route)).json()["items"][0]["valid"]
    async with SessionLocal() as session:
        metadata = await session.get(VideoEditorAssetMetadata, asset_id)
        metadata.revision += 1
        await session.commit()
    invalid = (await client.get(route)).json()["items"][0]
    assert invalid["timelineRevision"] == 2 and not invalid["valid"]
