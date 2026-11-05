from __future__ import annotations

import io
import uuid

import httpx
import pytest
from PIL import Image, ImageChops
from pydantic import ValidationError

from app.capabilities.media_rendering.contracts import RenderPlan
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.text_layer import (
    FONT_ROOT,
    load_text_font,
    render_text_layer,
    wrap_text,
)
from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.video_editor.errors import VideoEditorNotFoundError, VideoEditorValidationError
from studio.apps.video_editor.frames import VideoEditorFrames
from studio.apps.video_editor.schemas import (
    VideoEditorClip,
    VideoEditorTimelineBatchIn,
    VideoEditorTimelineDocument,
)
from studio.apps.video_editor.timeline import apply_operations


def text_clip(**patch) -> dict:
    return {
        "id": "text-a",
        "trackId": "visual-1",
        "kind": "text",
        "name": "字幕",
        "text": "我们的故事，从这里开始\nHello 世界",
        "timelineStartUs": 1_000_000,
        "durationUs": 1_000_000,
        "fontSize": 48,
        "textColor": "#ffffff",
        "textMaxWidth": 800,
        "textStyle": {
            "align": "center",
            "strokeColor": "#000000",
            "strokeWidth": 2,
            "backgroundColor": "#123456",
            "backgroundOpacity": 0.6,
        },
        "fitMode": "native",
        "transform": {"x": 960, "y": 1000, "anchor": "bottomCenter"},
        **patch,
    }


def document(clip=None, *, locked=False) -> dict:
    return {
        "settings": {},
        "tracks": [
            {
                "id": "visual-1",
                "kind": "visual",
                "name": "文字",
                "order": 0,
                "locked": locked,
                "clips": [clip or text_clip()],
            }
        ],
    }


def batch(*operations):
    return VideoEditorTimelineBatchIn.model_validate(
        {"expectedRevision": 0, "requestId": "test-text-operation", "operations": list(operations)}
    )


def test_measured_wrap_preserves_mixed_text_spaces_and_blank_lines():
    font = load_text_font(str(FONT_ROOT / "NotoSansSC-Regular.ttf"), 48)
    source = "中文 Hello WORLD 123\n\n第二行"
    lines = wrap_text(source, font, 180)
    assert "" in lines
    assert "".join(lines) == source.replace("\n", "")
    assert all(font.getlength(line) <= 180 for line in lines)
    assert len(wrap_text("iiiiiiii", font, 180)) < len(wrap_text("中文中文中文中文", font, 180))


@pytest.mark.parametrize("align", ["left", "center", "right"])
def test_text_layer_alignment_stroke_background_and_glyph_padding(align):
    clip = VideoEditorClip.model_validate(
        text_clip(text="你好 Hello", textStyle={"align": align, "strokeWidth": 3})
    )
    layer = render_text_layer(clip)
    bounds = layer.getchannel("A").getbbox()
    assert bounds and bounds[1] > 0 and bounds[3] < layer.height
    assert layer.width == 800
    if align == "left":
        assert bounds[0] < 24
    elif align == "right":
        assert bounds[2] > 770
    else:
        assert abs((bounds[0] + bounds[2]) / 2 - 400) < 6
    colors = {color for _count, color in layer.getcolors(layer.width * layer.height)}
    assert (0, 0, 0, 255) in colors  # opaque outline
    assert (255, 255, 255, 255) in colors
    filled = render_text_layer(VideoEditorClip.model_validate(text_clip()))
    assert filled.getpixel((filled.width // 2, 1)) == (18, 52, 86, 153)


def test_exact_frame_uses_identical_layer_and_half_open_time_interval():
    parsed = VideoEditorTimelineDocument.model_validate(document())
    renderer = TimelineFrameRenderer(parsed, FrameSource(lambda *_: None, lambda *_: None))
    layer = render_text_layer(parsed.tracks[0].clips[0])
    expected = Image.new("RGBA", (1920, 1080), "black")
    expected.alpha_composite(layer, (960 - layer.width // 2, 1000 - layer.height))
    assert (
        ImageChops.difference(renderer.render(1_000_000), expected.convert("RGB")).getbbox() is None
    )
    assert renderer.render(999_999).getbbox() is None
    assert renderer.render(2_000_000).getbbox() is None
    frame = Image.open(
        io.BytesIO(render_plan_frame(RenderPlan(parsed, {}), time_us=1_000_000, width=1920))
    )
    assert ImageChops.difference(frame, expected.convert("RGB")).getbbox() is None


def test_legacy_style_and_null_restore_remain_compatible():
    legacy = text_clip(textStyle=None)
    parsed = VideoEditorClip.model_validate(legacy)
    assert parsed.text_style is None
    rendered = render_text_layer(parsed)
    assert rendered.width < 800  # legacy natural-width layer
    updated = apply_operations(
        document(legacy),
        batch(
            {
                "type": "updateClip",
                "clipId": "text-a",
                "patch": {"textMaxWidth": 1200, "textStyle": {"align": "right", "strokeWidth": 4}},
            }
        ),
    )
    clip = updated["tracks"][0]["clips"][0]
    assert clip["textMaxWidth"] == 1200 and clip["textStyle"]["strokeWidth"] == 4
    restored = apply_operations(
        updated, batch({"type": "updateClip", "clipId": "text-a", "patch": {"textStyle": None}})
    )
    assert (
        VideoEditorTimelineDocument.model_validate(restored).tracks[0].clips[0].text_style is None
    )


@pytest.mark.parametrize(
    "patch",
    [
        {"text": " \n "},
        {"fontSize": 401},
        {"textStyle": {"strokeWidth": 21}},
        {"textStyle": {"backgroundOpacity": 1.1}},
        {"textMaxWidth": 79},
    ],
)
def test_invalid_text_values_rejected(patch):
    with pytest.raises(ValidationError):
        VideoEditorClip.model_validate(text_clip(**patch))


@pytest.mark.parametrize(
    "operation",
    [
        {"type": "updateClip", "clipId": "text-a", "patch": {"text": "不能改"}},
        {"type": "moveClip", "clipId": "text-a", "trackId": "visual-1", "timelineStartUs": 0},
        {"type": "removeClip", "clipId": "text-a"},
        {"type": "duplicateClip", "clipId": "text-a", "newClipId": "copy"},
        {"type": "splitClip", "clipId": "text-a", "atUs": 1_500_000, "newClipId": "split"},
        {"type": "addClip", "clip": text_clip(id="other", timelineStartUs=3_000_000)},
    ],
)
def test_locked_text_track_is_enforced_by_backend(operation):
    with pytest.raises(VideoEditorValidationError, match="锁定"):
        apply_operations(document(locked=True), batch(operation))


@pytest.mark.asyncio
async def test_text_api_save_reload_layer_cas_and_workspace_isolation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "文字测试"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"

        async def commit(revision, operations):
            return await client.post(
                base + "/timeline/operations",
                json={
                    "expectedRevision": revision,
                    "requestId": str(uuid.uuid4()),
                    "operations": operations,
                },
            )

        saved = await commit(0, [{"type": "addClip", "clip": text_clip()}])
        assert saved.status_code == 200, saved.text
        reloaded = (await client.get(base + "/timeline")).json()
        assert reloaded["document"]["tracks"][0]["clips"][0]["textStyle"]["strokeWidth"] == 2
        layer = await client.get(base + "/text-clips/text-a/layer", params={"revision": 1})
        assert layer.status_code == 200 and layer.headers["content-type"] == "image/png"
        assert Image.open(io.BytesIO(layer.content)).mode == "RGBA"
        assert (
            await client.get(base + "/text-clips/text-a/layer", params={"revision": 0})
        ).status_code == 409
        assert (
            await client.get(base + "/text-clips/missing/layer", params={"revision": 1})
        ).status_code == 404
        assert (await client.get(base + "/text-clips/text-a/layer")).status_code == 422
        async with SessionLocal() as session:
            with pytest.raises(VideoEditorNotFoundError):
                await VideoEditorFrames(session, "another-workspace").text_layer(
                    project["id"], clip_id="text-a", revision=1
                )
        invalid = await commit(
            1, [{"type": "updateClip", "clipId": "text-a", "patch": {"text": "  "}}]
        )
        assert invalid.status_code == 422
        assert (await client.get(base + "/timeline")).json()["revision"] == 1
        overlap = await commit(1, [{"type": "addClip", "clip": text_clip(id="overlap")}])
        assert overlap.status_code == 422


@pytest.mark.asyncio
async def test_text_track_with_many_clips_saves_in_one_timeline_operation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "字幕批量导入"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        clips = [
            text_clip(
                id=f"subtitle-{index}",
                trackId="subtitle-track",
                timelineStartUs=index * 500_000,
                durationUs=400_000,
                text=f"字幕 {index}",
            )
            for index in range(220)
        ]
        subtitle_track = {
            "id": "subtitle-track",
            "kind": "visual",
            "name": "字幕",
            "order": 0,
            "locked": False,
            "hidden": False,
            "muted": False,
            "clips": clips,
        }
        response = await client.post(
            base + "/timeline/operations",
            json={
                "expectedRevision": 0,
                "requestId": str(uuid.uuid4()),
                "operations": [
                    {"type": "reorderTrack", "trackId": "visual-1", "order": 1},
                    {"type": "reorderTrack", "trackId": "mixed-1", "order": 2},
                    {"type": "reorderTrack", "trackId": "audio-1", "order": 3},
                    {"type": "addTrack", "track": subtitle_track},
                ],
            },
        )
        assert response.status_code == 200, response.text
        document = (await client.get(base + "/timeline")).json()["document"]
        ordered_tracks = sorted(document["tracks"], key=lambda track: track["order"])
        assert ordered_tracks[0]["name"] == "字幕"
        assert len(ordered_tracks[0]["clips"]) == 220
        assert (await client.get(base + "/timeline")).json()["revision"] == 1

        overlap = await client.post(
            base + "/timeline/operations",
            json={
                "expectedRevision": 1,
                "requestId": str(uuid.uuid4()),
                "operations": [
                    {
                        "type": "addTrack",
                        "track": {
                            **subtitle_track,
                            "id": "overlapping-subtitle-track",
                            "clips": [
                                {**clips[0], "trackId": "overlapping-subtitle-track"},
                                {
                                    **clips[1],
                                    "id": "overlap-subtitle",
                                    "trackId": "overlapping-subtitle-track",
                                    "timelineStartUs": 100_000,
                                },
                            ],
                        },
                    }
                ],
            },
        )
        assert overlap.status_code == 422
        await client.delete(base)
