"""Replace editing and frame adapters without a database, Request or ASGI app."""

from unittest.mock import AsyncMock

import pytest

from studio.apps.video_editor.frame_requests import FrameRequests
from studio.apps.video_editor.schemas import VideoEditorTimelineBatchIn, VideoEditorTimelineOut
from studio.apps.video_editor.use_cases.edit_timeline import EditTimeline
from studio.runtime.revisions import RevisionConflictError


def snapshot(revision=0):
    return VideoEditorTimelineOut.model_validate(
        {
            "projectId": "project",
            "revision": revision,
            "updatedAt": "2026-11-16T00:00:00Z",
            "document": {
                "schemaVersion": "1.0",
                "settings": {
                    "width": 1920,
                    "height": 1080,
                    "fps": 30,
                    "backgroundColor": "#000000",
                },
                "tracks": [
                    {
                        "id": "visual-1",
                        "name": "画面",
                        "kind": "visual",
                        "order": 0,
                        "locked": False,
                        "hidden": False,
                        "muted": False,
                        "clips": [],
                    }
                ],
            },
        }
    )


def command():
    return VideoEditorTimelineBatchIn.model_validate(
        {
            "expectedRevision": 0,
            "requestId": "port-command",
            "operations": [
                {"type": "updateTrack", "trackId": "visual-1", "patch": {"name": "edited"}}
            ],
        }
    )


async def test_editing_uses_detached_facts_and_one_commit():
    store = AsyncMock()
    store.get.return_value = snapshot()
    store.replay.return_value = None
    store.contexts.return_value = {}
    store.commit.return_value = snapshot(1)
    assets = AsyncMock()
    result = await EditTimeline(store, assets).execute("project", command())
    assert result.revision == 1
    assert store.commit.await_args.args[2]["tracks"][0]["name"] == "edited"
    assets.describe.assert_not_awaited()
    assets.guard_write.assert_awaited_once_with("project")
    store.commit.assert_awaited_once()


async def test_replay_returns_current_snapshot_without_repeating_effects():
    store, assets = AsyncMock(), AsyncMock()
    store.get.return_value = snapshot(2)
    store.replay.return_value = snapshot(2)
    result = await EditTimeline(store, assets).execute("project", command())
    assert result.revision == 2
    store.contexts.assert_not_awaited()
    store.commit.assert_not_awaited()
    assets.guard_write.assert_not_awaited()


async def test_revision_conflict_precedes_asset_io_and_writes():
    store, assets = AsyncMock(), AsyncMock()
    store.get.return_value = snapshot(2)
    store.replay.return_value = None
    with pytest.raises(RevisionConflictError):
        await EditTimeline(store, assets).execute("project", command())
    store.contexts.assert_not_awaited()
    store.commit.assert_not_awaited()


async def test_frame_renderer_can_be_replaced_without_http_or_database():
    timelines, assets, renderer = AsyncMock(), AsyncMock(), AsyncMock()
    timelines.get.return_value = snapshot()
    assets.originals.return_value = {}
    renderer.render.return_value = b"png"
    frames = FrameRequests(timelines, assets, renderer)
    assert await frames.frame("project", 0, 0, 960, None) == b"png"
    assert renderer.render.await_args.args[:2] == ("project", "frame")
    renderer.render.reset_mock()
    with pytest.raises(RevisionConflictError):
        await frames.frame("project", 1, 0, 960, None)
    renderer.render.assert_not_awaited()
