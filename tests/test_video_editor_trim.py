import io
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from website_test_support import app


@pytest.mark.asyncio
async def test_image_mixed_trim_restore_lock_overlap_and_conflict_via_api():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "图片裁剪"})
        ).json()
        base = f"/v1/video-editor/projects/{project['id']}"
        image = io.BytesIO()
        Image.new("RGB", (32, 32), "red").save(image, format="PNG")
        uploaded = await client.post(
            f"{base}/assets", files={"upload": ("end.png", image.getvalue(), "image/png")}
        )
        assert uploaded.status_code == 200, uploaded.text
        asset_id = uploaded.json()["id"]

        async def read():
            return (await client.get(f"{base}/timeline")).json()

        async def apply(*operations, revision=None):
            current = await read()
            return await client.post(
                f"{base}/timeline/operations",
                json={
                    "expectedRevision": current["revision"] if revision is None else revision,
                    "requestId": str(uuid4()),
                    "operations": list(operations),
                },
            )

        tracks = (await read())["document"]["tracks"]
        mixed = next(t["id"] for t in tracks if t["kind"] == "mixed")
        visual = next(t["id"] for t in tracks if t["kind"] == "visual")
        audio = next(t["id"] for t in tracks if t["kind"] == "audio")
        clip = {
            "id": "end",
            "trackId": mixed,
            "kind": "image",
            "assetId": asset_id,
            "name": "结尾",
            "timelineStartUs": 2_000_000,
            "durationUs": 5_000_000,
            "transitionOut": {"kind": "crossfade", "durationUs": 4_000_000},
            "keyframes": [
                {"id": "early", "property": "opacity", "timeUs": 500_000, "value": 0.5},
                {"id": "middle", "property": "opacity", "timeUs": 2_000_000, "value": 1},
                {"id": "late", "property": "opacity", "timeUs": 4_000_000, "value": 0.5},
            ],
        }
        result = await apply({"type": "addClip", "clip": clip})
        assert result.status_code == 200, result.text
        original = deepcopy(
            next(t for t in result.json()["document"]["tracks"] if t["id"] == mixed)["clips"][0]
        )
        trim = {
            "type": "trimClip",
            "clipId": "end",
            "timelineStartUs": 3_000_000,
            "durationUs": 2_000_000,
            "sourceInUs": 0,
        }
        changed = await apply(trim)
        assert changed.status_code == 200, changed.text
        current = next(t for t in changed.json()["document"]["tracks"] if t["id"] == mixed)[
            "clips"
        ][0]
        assert [(key["id"], key["timeUs"]) for key in current["keyframes"]] == [
            ("middle", 1_000_000)
        ]
        assert current["transitionOut"]["durationUs"] == 2_000_000
        restored = await apply({"type": "restoreClipStates", "clips": [original]})
        assert next(t for t in restored.json()["document"]["tracks"] if t["id"] == mixed)[
            "clips"
        ] == [original]
        assert (await apply(trim, revision=changed.json()["revision"])).status_code == 409
        assert (await apply(trim)).status_code == 200
        assert (await apply({**trim, "durationUs": 20_000_000})).status_code == 200
        for target in (visual, mixed):
            moved = await apply(
                {"type": "moveClip", "clipId": "end", "trackId": target, "timelineStartUs": 0}
            )
            assert moved.status_code == 200, moved.text
        before = await read()
        bad = await apply(
            {"type": "moveClip", "clipId": "end", "trackId": audio, "timelineStartUs": 0}
        )
        assert bad.status_code == 422
        assert await read() == before
        collision = await apply({"type": "addClip", "clip": {**clip, "id": "overlap"}})
        assert collision.status_code == 422
        assert await read() == before
        locked = await apply({"type": "updateTrack", "trackId": mixed, "patch": {"locked": True}})
        assert locked.status_code == 200
        before = await read()
        assert (await apply(trim)).status_code == 422
        assert await read() == before
