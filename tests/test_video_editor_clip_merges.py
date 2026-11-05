import subprocess
from array import array
from pathlib import Path

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.capabilities.media_rendering.evaluator import FrameSource, TimelineFrameRenderer
from app.capabilities.media_rendering.timeline_document import parse_timeline_document
from app.main import app
from app.runtime.db import SessionLocal
from studio.apps.video_editor.clip_merging.document import (
    render_snapshot,
    replace_selection,
    selection,
)
from studio.apps.video_editor.errors import VideoEditorValidationError
from studio.apps.video_editor.runner import VideoEditorRunner
from studio.apps.video_editor.storage.models import VideoEditorTask


def document() -> dict:
    return parse_timeline_document(
        {
            "tracks": [
                {
                    "id": "v",
                    "kind": "mixed",
                    "name": "画面",
                    "order": 0,
                    "clips": [
                        {
                            "id": str(index),
                            "kind": "video",
                            "name": str(index),
                            "trackId": "v",
                            "assetId": f"asset-{index}",
                            "timelineStartUs": index * 200_000,
                            "durationUs": 200_000,
                        }
                        for index in range(4)
                    ],
                }
            ],
            "transitions": [
                {
                    "id": f"t-{index}",
                    "kind": "crossfade",
                    "placement": "between",
                    "fromClipId": str(index),
                    "toClipId": str(index + 1),
                    "durationUs": 50_000,
                }
                for index in range(3)
            ],
        }
    ).model_dump(mode="json", by_alias=True, exclude_none=True)


def test_selection_and_replacement_preserve_external_transitions_and_roundtrip() -> None:
    original = document()
    source = selection(original, ["2", "1"])
    assert [clip["id"] for clip in source["clips"]] == ["1", "2"]
    snapshot = render_snapshot(original, source)
    assert [item["id"] for item in snapshot["transitions"]] == ["t-1"]
    context = {"source": source, "assetId": "merged-asset", "name": "合并"}
    merged = replace_selection(original, context, "merged", undo=False)
    assert [item["id"] for item in merged["transitions"]] == ["t-0", "t-2"]
    assert merged["transitions"][0]["toClipId"] == "merged"
    assert merged["transitions"][1]["fromClipId"] == "merged"
    restored = replace_selection(merged, context, "merged", undo=True)
    assert (
        sorted(restored["tracks"][0]["clips"], key=lambda item: item["id"])
        == original["tracks"][0]["clips"]
    )
    assert sorted(restored["transitions"], key=lambda item: item["id"]) == original["transitions"]
    assert replace_selection(restored, context, "merged", undo=False) == merged
    assert original == document()


@pytest.mark.parametrize(
    "change", ["gap", "overlap", "locked", "linked", "kind", "cross_track", "missing"]
)
def test_invalid_selection(change: str) -> None:
    doc = document()
    clips = doc["tracks"][0]["clips"]
    if change == "gap":
        clips[1]["timelineStartUs"] += 1
    if change == "overlap":
        clips[1]["timelineStartUs"] -= 1
    if change == "locked":
        doc["tracks"][0]["locked"] = True
    if change == "linked":
        clips[1]["linkGroupId"] = "audio-link"
    if change == "kind":
        clips[1]["kind"] = "image"
    if change == "missing":
        clips.pop(1)
    if change == "cross_track":
        moved = clips.pop(1)
        moved["trackId"] = "other"
        doc["tracks"].append(
            {"id": "other", "kind": "visual", "name": "other", "order": 1, "clips": [moved]}
        )
    with pytest.raises(VideoEditorValidationError):
        selection(doc, ["0", "1"])


@pytest.mark.parametrize("change", ["clip", "track", "settings", "transition", "neighbor"])
def test_changed_source_never_replaces_selection(change: str) -> None:
    doc = document()
    context = {"source": selection(doc, ["1", "2"]), "assetId": "out", "name": "merged"}
    if change == "clip":
        doc["tracks"][0]["clips"][1]["volume"] = 0.5
    if change == "track":
        doc["tracks"][0]["muted"] = True
    if change == "settings":
        doc["settings"]["fps"] = 60
    if change == "transition":
        doc["transitions"][0]["durationUs"] = 40_000
    if change == "neighbor":
        doc["tracks"][0]["clips"][0]["name"] = "edited"
    with pytest.raises(VideoEditorValidationError, match="已变更"):
        replace_selection(doc, context, "new", undo=False)


def test_transparent_renderer_preserves_alpha_and_keyframes() -> None:
    doc = document()
    doc["tracks"][0]["clips"] = [doc["tracks"][0]["clips"][0]]
    doc["transitions"] = []
    doc["tracks"][0]["clips"][0].update(
        transform={"scaleX": 0.5, "scaleY": 0.5},
        keyframes=[{"id": "alpha", "property": "opacity", "timeUs": 0, "value": 0.5}],
    )
    renderer = TimelineFrameRenderer(
        parse_timeline_document(doc),
        FrameSource(
            image_for_clip=lambda *_args: Image.new("RGBA", (1920, 1080), "red"),
            font_for_clip=lambda _clip: None,
        ),
        transparent=True,
    )
    image = renderer.render(0)
    assert image.mode == "RGBA"
    assert image.getpixel((0, 0))[3] == 0
    assert image.getpixel((960, 540))[3] == pytest.approx(128, abs=1)


@pytest.mark.asyncio
@pytest.mark.parametrize("fps", [30, 60])
async def test_merge_api_real_render_apply_undo_redo_and_conflicts(
    tmp_path: Path, fps: int, monkeypatch: pytest.MonkeyPatch
) -> None:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        project = (
            await client.post("/v1/video-editor/projects", json={"title": "合并验收"})
        ).json()
        root = f"/v1/video-editor/projects/{project['id']}"
        try:
            assets = []
            for index, color in enumerate(("red", "blue")):
                path = tmp_path / f"{color}.mp4"
                subprocess.run(
                    [
                        "ffmpeg",
                        "-v",
                        "error",
                        "-f",
                        "lavfi",
                        "-i",
                        f"color=c={color}:s=64x64:r={fps}",
                        "-f",
                        "lavfi",
                        "-i",
                        f"sine=frequency={440 + index * 440}:sample_rate=48000",
                        "-t",
                        "0.4",
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        "-c:a",
                        "aac",
                        str(path),
                    ],
                    check=True,
                    capture_output=True,
                )
                response = await client.post(
                    f"{root}/assets", files={"upload": (path.name, path.read_bytes(), "video/mp4")}
                )
                assert response.status_code == 200, response.text
                assets.append(response.json())
            async with SessionLocal() as session:
                tasks = list(
                    await session.scalars(
                        select(VideoEditorTask.id).where(
                            VideoEditorTask.project_id == project["id"],
                            VideoEditorTask.kind == "media",
                        )
                    )
                )
            runner = VideoEditorRunner()
            for task_id in tasks:
                await runner._process(task_id)
            clips = [
                {
                    "id": f"clip-{index}",
                    "trackId": "mixed-1",
                    "kind": "video",
                    "name": str(index),
                    "assetId": asset["id"],
                    "timelineStartUs": 100_000 + index * 200_000,
                    "durationUs": 200_000,
                    "sourceInUs": 50_000,
                    "transform": {"scaleX": 0.5, "scaleY": 0.5},
                }
                for index, asset in enumerate(assets)
            ]
            duration_us = 400_001 if fps == 60 else 400_000
            clips[-1]["durationUs"] += duration_us - 400_000
            saved = await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": 0,
                    "requestId": "setup-clips",
                    "operations": [
                        {"type": "updateSettings", "patch": {"fps": fps}},
                        *[{"type": "addClip", "clip": clip} for clip in clips],
                    ],
                },
            )
            assert saved.status_code == 200, saved.text
            body = {
                "expectedRevision": 1,
                "requestId": "merge-roundtrip",
                "clipIds": ["clip-1", "clip-0"],
                "name": "合并",
            }
            if fps == 30:
                cancelled = (
                    await client.post(
                        f"{root}/clip-merges", json={**body, "requestId": "cancel-before-start"}
                    )
                ).json()
                stopped = await client.post(f"{root}/clip-merges/{cancelled['id']}/cancel")
                assert stopped.json()["status"] == "cancelled"
                await runner._process(cancelled["id"])
                assert (await client.get(f"{root}/clip-merges/{cancelled['id']}")).json()[
                    "outputAssetId"
                ] is None
                failed = (
                    await client.post(
                        f"{root}/clip-merges", json={**body, "requestId": "failed-render-test"}
                    )
                ).json()
                from studio.apps.video_editor.clip_merging import runner as merge_runner

                def fail_render(*_args, **_kwargs):
                    raise RuntimeError("encoding failed")

                with monkeypatch.context() as patch:
                    patch.setattr(merge_runner, "render_document", fail_render)
                    await runner._process(failed["id"])
                assert (await client.get(f"{root}/clip-merges/{failed['id']}")).json()[
                    "status"
                ] == "failed"
                assert (await client.get(f"{root}/timeline")).json() == saved.json()
            response = await client.post(f"{root}/clip-merges", json=body)
            assert response.status_code == 200, response.text
            task = response.json()
            repeated = await client.post(f"{root}/clip-merges", json=body)
            assert repeated.json()["id"] == task["id"]
            reused = await client.post(f"{root}/clip-merges", json={**body, "name": "different"})
            assert reused.status_code == 422
            await runner._process(task["id"])
            result = (await client.get(f"{root}/clip-merges/{task['id']}")).json()
            assert result["status"] == "completed", result.get("error")
            assert (await client.get(f"{root}/timeline")).json()["revision"] == 1
            listed = (await client.get(f"{root}/assets")).json()["items"]
            output = next(asset for asset in listed if asset["id"] == result["outputAssetId"])
            assert output["proxyUrl"] and output["processingStatus"] == "ready"
            merged_file = tmp_path / "merged.mov"
            downloaded = await client.get(f"/v1/files/{result['outputAssetId']}/download")
            assert downloaded.status_code == 200
            merged_file.write_bytes(downloaded.content)
            for at, channel in (("0.05", 0), ("0.25", 2)):
                frame = subprocess.run(
                    [
                        "ffmpeg",
                        "-v",
                        "error",
                        "-ss",
                        at,
                        "-i",
                        str(merged_file),
                        "-frames:v",
                        "1",
                        "-f",
                        "rawvideo",
                        "-pix_fmt",
                        "rgba",
                        "pipe:1",
                    ],
                    check=True,
                    capture_output=True,
                ).stdout
                center = (540 * 1920 + 960) * 4
                assert frame[center + channel] > 220
                assert frame[3] == 0
                assert frame[center + 3] >= 250
            pcm = subprocess.run(
                [
                    "ffmpeg",
                    "-v",
                    "error",
                    "-i",
                    str(merged_file),
                    "-vn",
                    "-ac",
                    "1",
                    "-ar",
                    "48000",
                    "-f",
                    "s16le",
                    "pipe:1",
                ],
                check=True,
                capture_output=True,
            ).stdout
            samples = array("h", pcm)
            for at, frequency in ((0.04, 440), (0.24, 880)):
                window = samples[round(at * 48000) : round((at + 0.1) * 48000)]
                crossings = sum(a <= 0 < b for a, b in zip(window, window[1:], strict=False))
                assert crossings * 10 == pytest.approx(frequency, rel=0.08)

            action = {"type": "applyClipMerge", "taskId": task["id"], "newClipId": "merged"}
            for index, kind in enumerate(
                ("applyClipMerge", "undoClipMerge", "applyClipMerge"), start=1
            ):
                applied = await client.post(
                    f"{root}/timeline/operations",
                    json={
                        "expectedRevision": index,
                        "requestId": f"merge-operation-{index}",
                        "operations": [{**action, "type": kind}],
                    },
                )
                assert applied.status_code == 200, applied.text
                merged = applied.json()["document"]["tracks"][1]["clips"]
                assert len(merged) == (2 if kind == "undoClipMerge" else 1)
                if kind != "undoClipMerge":
                    assert merged[0]["timelineStartUs"] == 100_000
                    assert merged[0]["durationUs"] == duration_us
                    assert merged[0]["transform"]["scaleX"] == 1
            stale = await client.post(
                f"{root}/timeline/operations",
                json={"expectedRevision": 1, "requestId": "stale-apply", "operations": [action]},
            )
            assert stale.status_code == 409
            await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": 4,
                    "requestId": "restore-before-edit",
                    "operations": [{**action, "type": "undoClipMerge"}],
                },
            )
            edited = await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": 5,
                    "requestId": "edit-during-merge",
                    "operations": [
                        {"type": "updateClip", "clipId": "clip-0", "patch": {"volume": 0.5}}
                    ],
                },
            )
            conflict = await client.post(
                f"{root}/timeline/operations",
                json={
                    "expectedRevision": 6,
                    "requestId": "reject-changed-source",
                    "operations": [action],
                },
            )
            assert conflict.status_code == 422
            assert conflict.json()["code"] == "merge_source_changed"
            assert (await client.get(f"{root}/timeline")).json() == edited.json()
            assert (await client.get(f"{root}/assets")).json()["items"] == listed

            another = (
                await client.post("/v1/video-editor/projects", json={"title": "其他项目"})
            ).json()
            wrong = await client.get(
                f"/v1/video-editor/projects/{another['id']}/clip-merges/{task['id']}"
            )
            assert wrong.status_code == 404
            await client.delete(f"/v1/video-editor/projects/{another['id']}?expected_revision=0")
        finally:
            await client.delete(f"{root}?expected_revision=0")
