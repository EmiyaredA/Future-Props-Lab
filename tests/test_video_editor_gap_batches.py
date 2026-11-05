"""Gap plans use existing formal operations, CAS, and deterministic rendering."""

import io
import subprocess
from copy import deepcopy
from uuid import uuid4

import httpx
import pytest
from PIL import Image

from app.main import app
from studio.apps.video_editor.runner import VideoEditorRunner


def picture(clip_id, start, duration=100_003):
    return {
        "id": clip_id,
        "name": clip_id,
        "trackId": "visual-1",
        "kind": "color",
        "color": "#ff0000",
        "timelineStartUs": start,
        "durationUs": duration,
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("fps", [30, 60])
@pytest.mark.parametrize("mode", ["extend", "ripple", "freeze"])
async def test_exact_gap_batch_cas_restore_and_short_output(fps, mode, tmp_path):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "隔离空隙批处理"})
        ).json()
        root = f"/v1/video-editor/projects/{project['id']}"
        state = (await client.get(f"{root}/timeline")).json()

        async def submit(operations, revision=None):
            return await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": state["revision"] if revision is None else revision,
                    "requestId": str(uuid4()),
                    "operations": operations,
                },
            )

        seeded = await submit(
            [{"type": "updateSettings", "patch": {"fps": fps}}]
            + [
                {"type": "addClip", "clip": item}
                for item in [
                    picture("left", 0),
                    picture("middle", 149_710),
                    picture("right", 299_713),
                ]
            ]
        )
        assert seeded.status_code == 200, seeded.text
        state = seeded.json()
        original = deepcopy(state)
        items = state["document"]["tracks"][0]["clips"]
        if mode == "extend":
            changed = [{**items[0], "durationUs": 149_710}, {**items[1], "durationUs": 150_003}]
            redo = [{"type": "restoreClipStates", "clips": changed}]
            undo = [{"type": "restoreClipStates", "clips": items[:2]}]
        elif mode == "ripple":
            changed = [
                {**items[1], "timelineStartUs": 100_003},
                {**items[2], "timelineStartUs": 200_006},
            ]
            redo = [{"type": "restoreClipStates", "clips": changed}]
            undo = [{"type": "restoreClipStates", "clips": items[1:]}]
        else:
            repairs = [picture("hold-1", 100_003, 49_707), picture("hold-2", 249_713, 50_000)]
            redo = [{"type": "addClip", "clip": item} for item in repairs]
            undo = [{"type": "removeClip", "clipId": item["id"]} for item in repairs]
        saved = await submit(redo)
        assert saved.status_code == 200, saved.text
        state = saved.json()
        completed = deepcopy(state["document"])
        ordered = sorted(completed["tracks"][0]["clips"], key=lambda item: item["timelineStartUs"])
        assert all(
            left["timelineStartUs"] + left["durationUs"] == right["timelineStartUs"]
            for left, right in zip(ordered, ordered[1:], strict=False)
        )
        stale = await submit(redo, original["revision"])
        assert stale.status_code == 409
        assert (await client.get(f"{root}/timeline")).json() == state
        invalid = {**ordered[1], "timelineStartUs": 1}
        failed = await submit(
            [
                {
                    "type": "restoreClipStates",
                    "clips": [{**ordered[0], "name": "must not persist"}, invalid],
                }
            ]
        )
        assert failed.status_code == 422
        assert (await client.get(f"{root}/timeline")).json() == state
        restored = await submit(undo)
        assert restored.status_code == 200, restored.text
        state = restored.json()
        assert state["document"] == original["document"]
        repeated = await submit(redo)
        assert repeated.status_code == 200, repeated.text
        state = repeated.json()
        assert state["document"] == completed

        # Real preflight and render task use the saved exact microsecond document.
        body = {"expectedRevision": state["revision"], "preset": f"720p{fps}", "startUs": 0}
        preview = await client.post(f"{root}/renders/preflight", json=body)
        assert preview.status_code == 200, preview.text
        assert preview.json()["ready"]
        created = await client.post(
            f"{root}/renders",
            json={
                **body,
                "requestId": str(uuid4()),
                "previewFingerprint": preview.json()["fingerprint"],
            },
        )
        assert created.status_code == 200, created.text
        task = created.json()
        await VideoEditorRunner()._process(task["id"])
        finished = (await client.get(f"{root}/renders/{task['id']}")).json()
        assert finished["status"] == "completed", finished.get("error")
        output = await client.get(f"/v1/files/{finished['outputAssetId']}/download")
        assert output.status_code == 200, output.text
        path = tmp_path / "gap-repaired.mp4"
        path.write_bytes(output.content)
        raw = subprocess.run(
            [
                "ffmpeg",
                "-v",
                "error",
                "-i",
                str(path),
                "-vf",
                "scale=1:1",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgb24",
                "-",
            ],
            check=True,
            capture_output=True,
        ).stdout
        assert raw and all(
            raw[index] > 150 and raw[index + 1] < 70 for index in range(0, len(raw), 3)
        )
        frame = await client.get(
            f"{root}/preview/frame",
            params={"revision": state["revision"], "timeUs": 123_457, "width": 320},
        )
        assert frame.status_code == 200, frame.text
        with Image.open(io.BytesIO(frame.content)) as image:
            red, green, _blue = image.convert("RGB").getpixel((160, 90))
            assert red > 200 and green < 20
