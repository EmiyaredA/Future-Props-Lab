"""Short freeze clips retain exact duration limits through the formal timeline API."""

import io
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.main import app


@pytest.mark.parametrize("duration_us", [125_001, 33_333])
@pytest.mark.parametrize("placement", ["between", "in", "out"])
@pytest.mark.parametrize("kind", ["eyelid", "spin-blur"])
async def test_short_transition_save_undo_redo(duration_us, placement, kind):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "短定帧转场"})
        ).json()
        root = f"/v1/video-editor/projects/{project['id']}"
        image = io.BytesIO()
        Image.new("RGB", (16, 9), "red").save(image, format="PNG")
        uploaded = await client.post(
            f"{root}/assets", files={"upload": ("freeze.png", image.getvalue(), "image/png")}
        )
        assert uploaded.status_code == 200, uploaded.text
        state = (await client.get(f"{root}/timeline")).json()
        track_id = state["document"]["tracks"][0]["id"]

        async def submit(operations):
            return await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": state["revision"],
                    "requestId": str(uuid4()),
                    "operations": operations,
                },
            )

        seeded = await submit(
            [
                {
                    "type": "addClip",
                    "clip": {
                        "id": clip_id,
                        "trackId": track_id,
                        "kind": "image",
                        "name": clip_id,
                        "assetId": uploaded.json()["id"],
                        "timelineStartUs": start,
                        "durationUs": duration,
                    },
                }
                for clip_id, start, duration in [
                    ("freeze", 0, duration_us),
                    ("next", duration_us, 10_125_000),
                ]
            ]
        )
        assert seeded.status_code == 200, seeded.text
        state = seeded.json()
        original = deepcopy(state)
        transition = {"kind": kind, "durationUs": 500_000}
        if placement == "between":
            transition.update(id="seam", fromClipId="freeze", toClipId="next")
            redo = {"type": "addTransition", "transition": transition}
            undo = {"type": "removeTransition", "transitionId": "seam"}
        else:
            redo = {
                "type": "setTransition",
                "clipId": "freeze",
                "edge": placement,
                "transition": transition,
            }
            undo = {"type": "setTransition", "clipId": "freeze", "edge": placement}
        rejected = await submit([redo])
        assert rejected.status_code == 422, rejected.text
        assert (await client.get(f"{root}/timeline")).json() == original

        transition["durationUs"] = duration_us
        saved = await submit([redo])
        assert saved.status_code == 200, saved.text
        state = saved.json()
        applied = deepcopy(state["document"])
        if placement == "between":
            actual = applied["transitions"][0]
        else:
            actual = applied["tracks"][0]["clips"][0][
                "transitionIn" if placement == "in" else "transitionOut"
            ]
        assert actual["durationUs"] == duration_us
        assert actual["kind"] == kind

        restored = await submit([undo])
        assert restored.status_code == 200, restored.text
        state = restored.json()
        assert state["document"] == original["document"]
        repeated = await submit([redo])
        assert repeated.status_code == 200, repeated.text
        assert repeated.json()["document"] == applied
