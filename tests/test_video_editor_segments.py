from __future__ import annotations

import io
import json
import subprocess
from pathlib import Path
from zipfile import ZipFile

import httpx
import pytest
from sqlalchemy import select

from app.capabilities.asset_store.library import AssetLibrary
from app.main import app
from app.models import VideoEditorTask, VisualAsset
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from app.video_editor import segment_files
from app.video_editor.runner import VideoEditorRunner
from app.video_editor.segment_files import download_segments, segment_filename


@pytest.fixture
def video(tmp_path: Path) -> bytes:
    path = tmp_path / "source.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:r=30",
            "-t",
            "1",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            str(path),
        ],
        check=True,
        capture_output=True,
    )
    return path.read_bytes()


async def prepare(client: httpx.AsyncClient, video: bytes) -> tuple[str, dict]:
    project = (await client.post("/v1/video-editor/projects", json={"title": "分段测试"})).json()
    root = f"/v1/video-editor/projects/{project['id']}"
    uploaded = await client.post(
        f"{root}/assets", files={"upload": ("source.mp4", video, "video/mp4")}
    )
    assert uploaded.status_code == 200, uploaded.text
    runner = VideoEditorRunner()
    async with SessionLocal() as session:
        task_id = await session.scalar(
            select(VideoEditorTask.id).where(
                VideoEditorTask.project_id == project["id"], VideoEditorTask.kind == "media"
            )
        )
    assert task_id
    await runner._process(task_id)
    clips = [
        {
            "id": f"clip-{index}",
            "trackId": "visual-1",
            "kind": "video",
            "name": f"片段{index}",
            "timelineStartUs": index * 200_000,
            "sourceInUs": index * 200_000,
            "durationUs": 200_000,
            "assetId": uploaded.json()["id"],
        }
        for index in range(3)
    ]
    saved = await client.post(
        f"{root}/timeline/operations",
        json={
            "expectedRevision": 0,
            "requestId": "add-segment-clips",
            "operations": [{"type": "addClip", "clip": clip} for clip in clips],
        },
    )
    assert saved.status_code == 200, saved.text
    body = {
        "expectedRevision": 1,
        "requestId": "export-segments",
        "target": None,
        "segments": [
            {"clipId": "clip-0", "name": "../相同:镜头"},
            {"clipId": "clip-2", "name": "../相同:镜头"},
        ],
    }
    return root, body


@pytest.mark.asyncio
@pytest.mark.parametrize("target_mode", ["none", "new", "existing"])
async def test_segment_export_roundtrip(
    video: bytes, target_mode: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    archive_paths = []
    original_archive = segment_files._archive

    def tracked_archive(entries):
        path = original_archive(entries)
        archive_paths.append(path)
        return path

    monkeypatch.setattr(segment_files, "_archive", tracked_archive)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root, body = await prepare(client, video)
        if target_mode == "new":
            body["target"] = {"newProjectTitle": "新画布"}
        elif target_mode == "existing":
            canvas = (
                await client.post(
                    "/v1/visual-workshop/projects", json={"title": "已有画布", "kind": "canvas"}
                )
            ).json()
            body["target"] = {"projectId": canvas["id"]}
        before = (await client.get("/v1/visual-workshop/projects")).json()
        created = await client.post(f"{root}/segment-exports", json=body)
        assert created.status_code == 200, created.text
        task = created.json()
        task_url = f"{root}/segment-exports/{task['id']}"
        repeated = await client.post(f"{root}/segment-exports", json=body)
        assert repeated.json()["id"] == task["id"]
        assert (await client.get(f"{task_url}/download")).status_code == 409
        assert (
            await client.post(
                f"{root}/segment-exports", json={**body, "target": {"newProjectTitle": "不同目标"}}
            )
        ).status_code == 422
        await VideoEditorRunner()._process(task["id"])
        completed = (await client.get(task_url)).json()
        assert completed["status"] == "completed", completed.get("error")
        detail = completed["resultDetail"]
        assert detail["importRequested"] == (target_mode != "none")
        assert [item["clipId"] for item in detail["segments"]] == ["clip-0", "clip-2"]
        after = (await client.get("/v1/visual-workshop/projects")).json()
        if target_mode == "none":
            assert before == after
            assert detail["targetProjectId"] is None
            snapshot = await client.get(f"{root}/snapshot")
            assert snapshot.status_code == 200, snapshot.text
            with ZipFile(io.BytesIO(snapshot.content)) as archive:
                assert len(json.loads(archive.read("manifest.json"))["assets"]) == 1
        else:
            canvas = (
                await client.get(f"/v1/visual-workshop/projects/{detail['targetProjectId']}/canvas")
            ).json()
            assert len(canvas["nodes"]) == 2
        data = []
        for segment in detail["segments"]:
            response = await client.get(f"/v1/files/{segment['assetId']}/download")
            assert response.status_code == 200, response.text
            assert b"ftyp" in response.content[:32]
            data.append(response.content)
        zipped = await client.get(f"{task_url}/download")
        assert zipped.status_code == 200, zipped.text
        assert archive_paths and all(not path.exists() for path in archive_paths)
        other_project = (
            await client.post("/v1/video-editor/projects", json={"title": "另一剪辑项目"})
        ).json()
        mismatched = await client.get(
            f"/v1/video-editor/projects/{other_project['id']}/segment-exports/{task['id']}/download"
        )
        assert mismatched.status_code == 404
        with ZipFile(io.BytesIO(zipped.content)) as archive:
            assert archive.namelist() == [
                f"{index:03d}_{segment_filename('../相同:镜头')}" for index in (1, 2)
            ]
            assert [archive.read(name) for name in archive.namelist()] == data
        # Completed response cleanup and missing-file handling use the same exported path.
        async with SessionLocal() as session:
            path = await download_segments(
                session, get_settings(), "default", task["projectId"], task["id"]
            )
            assert path.is_file()
            path.unlink()
        if target_mode == "none":
            removed = await client.delete(f"{root}/assets/{detail['segments'][0]['assetId']}")
            assert removed.status_code in (200, 204), removed.text
            assert (await client.get(f"{task_url}/download")).status_code == 404


@pytest.mark.asyncio
async def test_segment_validation_cancel_and_canvas_conflict(video: bytes) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root, body = await prepare(client, video)
        for patch, status in [
            ({"segments": []}, 422),
            ({"segments": [body["segments"][0]] * 2}, 422),
            ({"target": {}}, 422),
            ({"expectedRevision": 0}, 409),
            ({"segments": [{"clipId": "missing", "name": "x"}]}, 422),
        ]:
            result = await client.post(f"{root}/segment-exports", json={**body, **patch})
            assert result.status_code == status, result.text
        missing_target = {key: value for key, value in body.items() if key != "target"}
        assert (
            await client.post(f"{root}/segment-exports", json=missing_target)
        ).status_code == 422
        cancelled = (await client.post(f"{root}/segment-exports", json=body)).json()
        task_url = f"{root}/segment-exports/{cancelled['id']}"
        assert (await client.post(f"{task_url}/cancel")).json()["status"] == "cancelled"
        assert (await client.get(f"{task_url}/download")).status_code == 409
        canvas = (
            await client.post(
                "/v1/visual-workshop/projects", json={"title": "冲突画布", "kind": "canvas"}
            )
        ).json()
        created = await client.post(
            f"{root}/segment-exports",
            json={
                **body,
                "requestId": "conflicting-target",
                "target": {"projectId": canvas["id"]},
            },
        )
        assert created.status_code == 200, created.text
        edited = await client.put(
            f"/v1/visual-workshop/projects/{canvas['id']}/canvas",
            json={"expected_revision": 0, "nodes": [], "edges": []},
        )
        assert edited.status_code == 200, edited.text
        await VideoEditorRunner()._process(created.json()["id"])
        failed = (await client.get(f"{root}/segment-exports/{created.json()['id']}")).json()
        assert failed["status"] == "failed", failed
        assert "画布已变化" in failed["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["copy", "cancel"])
async def test_staged_files_are_cleaned_without_partial_outputs(
    video: bytes, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root, body = await prepare(client, video)
        created = (await client.post(f"{root}/segment-exports", json=body)).json()
        staged_paths = []
        original = AssetLibrary.stage_local_copy

        async def stage(library, *args, **kwargs):
            assert kwargs["defer_persistence"] is True
            assert not library.session.in_transaction()
            if staged_paths and failure == "copy":
                raise RuntimeError("simulated copy failure")
            result = await original(library, *args, **kwargs)
            staged_paths.append(result[1])
            if failure == "cancel":
                await client.post(f"{root}/segment-exports/{created['id']}/cancel")
            return result

        monkeypatch.setattr(AssetLibrary, "stage_local_copy", stage)
        await VideoEditorRunner()._process(created["id"])
        task = (await client.get(f"{root}/segment-exports/{created['id']}")).json()
        assert task["status"] == ("failed" if failure == "copy" else "cancelled"), task
        assert staged_paths and all(not path.exists() for path in staged_paths)
        async with SessionLocal() as session:
            assets = list(
                await session.scalars(
                    select(VisualAsset).where(
                        VisualAsset.video_editor_project_id == created["projectId"]
                    )
                )
            )
            assert len(assets) == 1


def test_segment_filenames_are_portable() -> None:
    assert "/" not in segment_filename("../a/b")
    assert "\\" not in segment_filename("a\\b")
    assert len(segment_filename("镜" * 120).encode()) <= 204
