"""Directional effects remain portable and deterministic through the public timeline API."""

import io
from copy import deepcopy
from uuid import uuid4

import httpx
import numpy as np
import pytest
from PIL import Image, ImageChops, ImageDraw

from app.capabilities.media_rendering.directional_transitions import (
    light_leak,
    light_leak_strip,
    whip_pan,
)
from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.timeline_document import parse_timeline_document
from app.main import app


def pattern():
    layer = Image.new("RGBA", (160, 90), "#243858")
    ImageDraw.Draw(layer).rectangle((70, 30, 90, 60), fill="white")
    return layer


@pytest.mark.parametrize("direction", ["left", "right", "up", "down"])
def test_whip_extends_edges_without_mutating_source_or_darkening_transparent_color(direction):
    source = pattern()
    original = source.tobytes()
    positive = whip_pan(source, 0.6, direction)
    negative = whip_pan(source, -0.6, direction)
    assert source.tobytes() == original
    assert whip_pan(source, 0, direction) is source
    assert positive.getchannel("A").getextrema() == (255, 255)
    assert positive.tobytes() != negative.tobytes()
    assert positive.tobytes() == whip_pan(source, 0.6, direction).tobytes()
    pixels = np.asarray(positive)
    axis = 1 if direction in {"left", "right"} else 0
    weights = pixels[:, :, 0].astype(float) - 36
    center = (weights * np.indices(weights.shape)[axis]).sum() / weights.sum()
    assert (center < source.size[1 - axis] / 2) == (direction in {"left", "up"})

    transparent = Image.new("RGBA", (80, 45))
    ImageDraw.Draw(transparent).rectangle((35, 10, 50, 30), fill=(255, 0, 0, 255))
    partial = [
        p for p in whip_pan(transparent, 0.6, direction).get_flattened_data() if 0 < p[3] < 255
    ]
    assert partial and all(p[:3] == (255, 0, 0) for p in partial)


def test_leak_is_a_moving_yellow_green_screen_light_that_preserves_alpha():
    source = pattern()
    source.putalpha(Image.linear_gradient("L").resize(source.size))
    original = source.copy()
    assert light_leak(source, 0, "left") is source
    assert light_leak(source, 1, "right") is source
    for direction in ["left", "right", "up", "down"]:
        result = light_leak(source, 0.4, direction)
        assert result.getchannel("A").tobytes() == source.getchannel("A").tobytes()
        assert np.all(np.asarray(result)[:, :, :3] >= np.asarray(source)[:, :, :3])
        assert result.tobytes() == light_leak(source, 0.4, direction).tobytes()
    assert source.tobytes() == original.tobytes()
    left = np.asarray(light_leak_strip(160, 0.3, "left"))
    right = np.asarray(light_leak_strip(160, 0.3, "right"))
    assert np.array_equal(left, right[:, ::-1])
    assert np.all(left[:, :, 1] >= left[:, :, 2])
    assert light_leak_strip(161, 0.5, "left").getpixel((80, 0)) == (255, 255, 255)


@pytest.mark.parametrize("kind", ["whip-pan", "light-leak"])
@pytest.mark.parametrize("placement", ["between", "in", "out"])
@pytest.mark.parametrize("direction", ["left", "right", "up", "down"])
def test_effect_rendering_has_no_residue_outside_window(kind, placement, direction):
    clips = [
        {
            "id": name,
            "trackId": "v1",
            "kind": "image",
            "name": name,
            "assetId": name,
            "timelineStartUs": index * 2_000_000,
            "durationUs": 2_000_000,
            "fitMode": "native",
        }
        for index, name in enumerate(["a", "b"])
    ]
    raw = {"tracks": [{"id": "v1", "kind": "visual", "name": "V1", "order": 0, "clips": clips}]}
    transition = {"kind": kind, "direction": direction, "durationUs": 800_000, "easing": "linear"}
    if placement == "between":
        raw["transitions"] = [
            {
                **transition,
                "id": "effect",
                "fromClipId": "a",
                "toClipId": "b",
                "placement": "between",
            }
        ]
        times = [1_600_000, 2_000_000, 2_400_000]
    else:
        clips[0]["transitionIn" if placement == "in" else "transitionOut"] = transition
        times = [0, 400_000, 800_000] if placement == "in" else [1_200_000, 1_600_000, 2_000_000]
    renderer = TimelineFrameRenderer(
        parse_timeline_document(raw), FrameSource(lambda *_: pattern(), lambda _: None)
    )
    plain = deepcopy(raw)
    plain.pop("transitions", None)
    for clip in plain["tracks"][0]["clips"]:
        clip.pop("transitionIn", None)
        clip.pop("transitionOut", None)
    baseline = TimelineFrameRenderer(parse_timeline_document(plain), renderer.source)
    affected = renderer.render(times[1])
    assert ImageChops.difference(affected, baseline.render(times[1])).getbbox()
    assert affected.tobytes() == renderer.render(times[1]).tobytes()
    assert renderer.render(times[2]).tobytes() == baseline.render(times[2]).tobytes()
    if placement != "in":
        assert renderer.render(times[0]).tobytes() == baseline.render(times[0]).tobytes()


@pytest.mark.parametrize("kind", ["whip-pan", "light-leak"])
@pytest.mark.parametrize("placement", ["between", "in", "out"])
@pytest.mark.parametrize("direction", ["left", "right", "up", "down"])
async def test_api_short_clip_undo_redo_and_snapshot_round_trip(kind, placement, direction):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = (
            await client.post("/v1/video-editor/projects", json={"title": "方向转场测试"})
        ).json()
        root = f"/v1/video-editor/projects/{created['id']}"
        upload = io.BytesIO()
        pattern().save(upload, format="PNG")
        asset = (
            await client.post(
                f"{root}/assets", files={"upload": ("pattern.png", upload.getvalue(), "image/png")}
            )
        ).json()
        state = (await client.get(f"{root}/timeline")).json()
        track = state["document"]["tracks"][0]["id"]

        async def submit(operations):
            nonlocal state
            response = await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": state["revision"],
                    "requestId": str(uuid4()),
                    "operations": operations,
                },
            )
            if response.status_code == 200:
                state = response.json()
            return response

        assert (
            await submit(
                [
                    {
                        "type": "addClip",
                        "clip": {
                            "id": name,
                            "trackId": track,
                            "kind": "image",
                            "name": name,
                            "assetId": asset["id"],
                            "timelineStartUs": index * 125_001,
                            "durationUs": 125_001,
                        },
                    }
                    for index, name in enumerate(["a", "b"])
                ]
            )
        ).status_code == 200
        original = deepcopy(state["document"])
        transition = {
            "kind": kind,
            "direction": direction,
            "durationUs": 125_001,
            "easing": "ease-in-out",
        }
        if placement == "between":
            transition.update(id="seam", fromClipId="a", toClipId="b")
            redo = {"type": "addTransition", "transition": transition}
            undo = {"type": "removeTransition", "transitionId": "seam"}
        else:
            redo = {
                "type": "setTransition",
                "clipId": "a",
                "edge": placement,
                "transition": transition,
            }
            undo = {"type": "setTransition", "clipId": "a", "edge": placement}
        assert (await submit([redo])).status_code == 200
        applied = deepcopy(state["document"])
        assert (await submit([undo])).status_code == 200
        assert state["document"] == original
        assert (await submit([redo])).status_code == 200
        assert state["document"] == applied
        too_long = deepcopy(redo)
        too_long["transition"]["durationUs"] = 125_002
        assert (await submit([undo])).status_code == 200
        assert (await submit([too_long])).status_code == 422
        assert (await submit([redo])).status_code == 200
        exported = await client.get(f"{root}/snapshot")
        assert exported.status_code == 200
        imported = await client.post(
            "/v1/video-editor/projects/snapshot-imports",
            files={"file": ("snapshot.zip", exported.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        copied = (
            await client.get(
                f"/v1/video-editor/projects/{imported.json()['project']['id']}/timeline"
            )
        ).json()["document"]
        if placement == "between":
            assert copied["transitions"] == applied["transitions"]
        else:
            assert (
                copied["tracks"][0]["clips"][0][
                    "transitionIn" if placement == "in" else "transitionOut"
                ]
                == transition
            )
