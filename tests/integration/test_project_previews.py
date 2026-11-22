"""Automatic project cards select real, bounded content without writing projects."""

from types import SimpleNamespace

import httpx
import pytest

from studio.apps.audio_annotation.project_preview import audio_preview
from studio.apps.galgame_workshop.project_previews import story_preview
from studio.apps.motion_compositor.project_previews import composition_preview
from studio.apps.spreadsheet_workshop.preview import workbook_preview
from studio.apps.thought_workshop.project_previews import note_preview
from studio.apps.video_editor.project_previews import timeline_preview
from tests.apps.visual_workshop.test_visual_node_outputs import (
    create_project,
    node,
    save_canvas,
)
from website_test_support import app


def test_real_timeline_frame_ignores_audio_and_hidden_tracks():
    document = {
        "tracks": [
            {"kind": "audio", "clips": [{"timelineStartUs": 0, "durationUs": 999}]},
            {"hidden": True, "clips": [{"timelineStartUs": 0, "durationUs": 999}]},
            {
                "kind": "visual",
                "clips": [{"id": "clip", "timelineStartUs": 2000, "durationUs": 1000}],
            },
        ]
    }
    preview = timeline_preview("p", document, 7)
    assert "timeUs=2500" in preview.urls[0] and "revision=7" in preview.urls[0]
    assert timeline_preview("p", {"tracks": []}, 0) is None
    assert timeline_preview("p", document, 8).version != preview.version


def test_motion_preview_uses_composited_frame_and_visible_layer():
    document = {
        "settings": {"fps": 30},
        "layers": [
            {"visible": False, "startFrame": 0, "endFrame": 90},
            {"visible": True, "startFrame": 60, "endFrame": 100},
        ],
    }
    assert "frame=80" in composition_preview("p", document, 3).urls[0]
    assert composition_preview("p", {"layers": []}, 0) is None


def test_waveform_is_real_bounded_and_keeps_transcription():
    source = [0.1, -0.8, 0.5, -0.2] * 100
    preview = audio_preview(
        SimpleNamespace(peaks=[source], revision=1),
        SimpleNamespace(segments=[{"text": "今天讨论影片分镜。"}], revision=2),
        65000,
    )
    assert len(preview.peaks) == 96 and max(preview.peaks) == 0.8
    assert preview.text == "今天讨论影片分镜。" and preview.label == "1:05"
    assert not audio_preview(
        SimpleNamespace(peaks=[], revision=0), SimpleNamespace(segments=[], revision=0), 5000
    ).peaks


def test_spreadsheet_uses_saved_display_values_and_bounded_visible_cells():
    document = {
        "sheets": [
            {"name": "隐藏", "hide": True, "celldata": [{"r": 0, "c": 0, "v": {"v": "秘密"}}]},
            {
                "name": "预算",
                "celldata": [
                    {"r": 4, "c": 2, "v": {"v": 10, "m": "¥10", "bl": 1, "bg": "#ffeecc"}},
                    {"r": 4, "c": 3, "v": {"f": "=SUM(A1:A9)"}},
                    {"r": 100, "c": 100, "v": {"v": "不进入预览"}},
                ],
            },
        ]
    }
    preview = workbook_preview(document, 2)
    assert preview.label == "预算"
    assert preview.cells[0][0].text == "¥10" and preview.cells[0][0].bold
    assert len(preview.cells) <= 6 and len(preview.cells[0]) <= 5
    assert "=SUM" not in preview.model_dump_json() and "秘密" not in preview.model_dump_json()
    assert workbook_preview({"sheets": []}, 0) is None


def test_document_uses_first_actual_image_in_reading_order():
    document = {
        "type": "doc",
        "content": [
            {"type": "attachment", "attrs": {"assetId": "unused"}},
            {"type": "image", "attrs": {"assetId": "first"}},
            {"type": "image", "attrs": {"assetId": "second"}},
        ],
    }
    preview = note_preview("笔记", document, "摘要", 3)
    assert "/first/" in preview.urls[0] and "/second/" in preview.urls[1]
    assert note_preview("笔记", {}, "摘要", 3).kind == "text"


def test_galgame_uses_entry_fragment_not_arbitrary_uploaded_assets():
    document = {
        "entryChapterId": "second",
        "scenes": [{"id": "room", "layers": [{"assetId": "bg"}]}],
        "chapters": [
            {"id": "first", "fragments": []},
            {
                "id": "second",
                "entryFragmentId": "entry",
                "fragments": [
                    {"id": "other", "blocks": []},
                    {"id": "entry", "blocks": [{"type": "scene", "sceneId": "room"}]},
                ],
            },
        ],
    }
    preview = story_preview(document, 4)
    assert preview.source_id == "entry" and preview.source_revision == 4
    assert "/bg/" in preview.urls[0]


@pytest.mark.asyncio
async def test_visual_project_preview_is_read_only_and_updates_from_live_nodes():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        await save_canvas(client, project, [node("text", "text")])
        before = (await client.get(f"/v1/visual-workshop/projects/{project}/canvas")).json()
        listed = (await client.get("/v1/visual-workshop/projects")).json()["items"]
        preview = next(item["preview"] for item in listed if item["id"] == project)
        assert preview["kind"] == "text" and "小夏" in preview["text"]
        after = (await client.get(f"/v1/visual-workshop/projects/{project}/canvas")).json()
        assert before == after
        await save_canvas(client, project, [], revision=before["revision"])
        listed = (await client.get("/v1/visual-workshop/projects")).json()["items"]
        cleared = next(item["preview"] for item in listed if item["id"] == project)
        assert cleared["kind"] == "empty" and cleared["version"] != preview["version"]


@pytest.mark.asyncio
async def test_current_adopted_image_wins_over_newer_history_and_other_accounts():
    from studio.apps.visual_workshop.project_previews import project_previews
    from studio.runtime.database.ownership import bind_owner
    from tests.apps.visual_workshop.test_visual_node_outputs import PNG, upload
    from website_test_support import SessionLocal

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        asset = await upload(client, project)
        canvas = await save_canvas(client, project, [node("image", asset_id=asset)])
        base = f"/v1/visual-workshop/projects/{project}/nodes/image"
        old = (await client.get(base + "/outputs")).json()["items"][0]
        response = await client.post(
            base + "/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("new.png", PNG + b"new", "image/png")},
        )
        assert response.status_code == 200, response.text
        latest = response.json()
        response = await client.put(
            base + "/final-output",
            json={"expected_revision": latest["revision"], "output_id": old["id"]},
        )
        assert response.status_code == 200, response.text
        listed = (await client.get("/v1/visual-workshop/projects")).json()["items"]
        preview = next(item["preview"] for item in listed if item["id"] == project)
        assert f"/{asset}/" in preview["urls"][0]
        assert len(preview["urls"]) == 1
        async with SessionLocal() as session:
            bind_owner(session, "test-user")
            assert await project_previews(session, "different-account", [project]) == {}
