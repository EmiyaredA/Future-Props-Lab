from __future__ import annotations

import io
import json
import subprocess
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile

import httpx
import pytest
from sqlalchemy import delete, select, update

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.video_editor.handoffs import segment_files, segment_runner
from studio.apps.video_editor.handoffs.segment_files import download_segments, segment_filename
from studio.apps.video_editor.runner import VideoEditorRunner
from studio.apps.video_editor.storage.models import VideoEditorTask
from studio.apps.visual_workshop.outputs import register_imported_output
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.outputs.references import resolve_references
from studio.apps.visual_workshop.storage.models import VisualCanvasDocument
from studio.assembly.http_dependencies import owner_from_principal
from studio.config.settings import get_settings
from studio.contracts.model_service.generation_tasks import VideoGenerationTaskCreateIn
from website_test_support import SessionLocal, app


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
    runner = VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())
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
        previous_nodes = []
        previous_revision = 0
        if target_mode == "new":
            body["target"] = {"newProjectTitle": "新画布"}
        elif target_mode == "existing":
            canvas = (
                await client.post(
                    "/v1/visual-workshop/projects", json={"title": "已有画布", "kind": "canvas"}
                )
            ).json()
            body["target"] = {"projectId": canvas["id"]}
            previous = await client.post(
                f"/v1/visual-workshop/projects/{canvas['id']}/node-uploads",
                data={"expected_revision": 0, "x": 120, "y": 240},
                files={"file": ("existing.mp4", video, "video/mp4")},
            )
            assert previous.status_code == 200, previous.text
            previous_nodes = previous.json()["nodes"]
            previous_revision = previous.json()["revision"]
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
        await VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())._process(
            task["id"]
        )
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
            assert canvas["revision"] == previous_revision + 1
            assert canvas["nodes"][: len(previous_nodes)] == previous_nodes
            assert len(canvas["nodes"]) == len(previous_nodes) + 2
            for segment, node in zip(
                detail["segments"], canvas["nodes"][len(previous_nodes) :], strict=True
            ):
                assert node["id"] == segment["nodeId"]
                assert node["asset_id"] == segment["assetId"]
                assert node["final_version"] == node["output_sequence"] == 1
                history = (
                    await client.get(
                        f"/v1/visual-workshop/projects/{detail['targetProjectId']}"
                        f"/nodes/{node['id']}/outputs"
                    )
                ).json()
                assert history["total"] == 1
                output = history["items"][0]
                assert output["id"] == node["final_output_id"]
                assert output["version"] == 1 and output["is_final"]
                assert output["source"] == "uploaded"
                assert output["asset_id"] == segment["assetId"]
            # Reprocessing a completed task and resubmitting its request cannot
            # create extra nodes, versions or advance the canvas revision.
            await VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())._process(
                task["id"]
            )
            assert (await client.post(f"{root}/segment-exports", json=body)).json() == completed
            assert (
                await client.get(f"/v1/visual-workshop/projects/{detail['targetProjectId']}/canvas")
            ).json() == canvas
            async with SessionLocal() as session:
                await session.execute(
                    update(VisualCanvasDocument)
                    .where(VisualCanvasDocument.project_id == detail["targetProjectId"])
                    .values(revision=VisualCanvasDocument.revision)
                )
                for node in canvas["nodes"][len(previous_nodes) :]:
                    await register_imported_output(
                        session,
                        detail["targetProjectId"],
                        node,
                        asset_id=node["asset_id"],
                        source_key=f"segment:{task['id']}:{node['id']}",
                    )
                assert (
                    len(
                        list(
                            await session.scalars(
                                select(VisualNodeOutput).where(
                                    VisualNodeOutput.project_id == detail["targetProjectId"]
                                )
                            )
                        )
                    )
                    == len(previous_nodes) + 2
                )
                await session.commit()
            source = canvas["nodes"][len(previous_nodes)]
            linked = await client.put(
                f"/v1/visual-workshop/projects/{detail['targetProjectId']}/canvas",
                json={
                    "expected_revision": canvas["revision"],
                    "nodes": [
                        *canvas["nodes"],
                        {
                            "id": "reference-target",
                            "kind": "video",
                            "title": "下游视频",
                            "position": {"x": 0, "y": 500},
                        },
                    ],
                    "edges": [
                        {
                            "id": "follow-import",
                            "source_node_id": source["id"],
                            "target_node_id": "reference-target",
                            "binding": "final",
                        }
                    ],
                },
            )
            assert linked.status_code == 200, linked.text
            async with SessionLocal() as session:
                resolved, _, inputs = await resolve_references(
                    session,
                    detail["targetProjectId"],
                    VideoGenerationTaskCreateIn(
                        kind="video",
                        model_id="unused-model",
                        prompt="测试引用",
                        mode="text",
                        canvas_node_id="reference-target",
                        expected_canvas_revision=linked.json()["revision"],
                    ),
                )
                assert resolved.video_asset_ids == [source["asset_id"]]
                assert inputs[0]["output_id"] == source["final_output_id"]
                assert inputs[0]["version"] == 1
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
                session, get_settings(), "test-user", task["projectId"], task["id"]
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
        await VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())._process(
            created.json()["id"]
        )
        failed = (await client.get(f"{root}/segment-exports/{created.json()['id']}")).json()
        assert failed["status"] == "failed", failed
        assert "画布已变化" in failed["error"]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("failure", "target_mode"),
    [
        (failure, target_mode)
        for failure in ("copy", "cancel", "register")
        for target_mode in ("none", "new", "existing")
        if failure != "register" or target_mode != "none"
    ],
)
async def test_staged_files_are_cleaned_without_partial_outputs(
    video: bytes, monkeypatch: pytest.MonkeyPatch, failure: str, target_mode: str
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root, body = await prepare(client, video)
        projects_before = (await client.get("/v1/visual-workshop/projects")).json()
        canvas_before = None
        if target_mode == "new":
            body["target"] = {"newProjectTitle": "回滚画布"}
        elif target_mode == "existing":
            project = (
                await client.post(
                    "/v1/visual-workshop/projects", json={"title": "回滚画布", "kind": "canvas"}
                )
            ).json()
            body["target"] = {"projectId": project["id"]}
            canvas_before = (
                await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")
            ).json()
            projects_before = (await client.get("/v1/visual-workshop/projects")).json()
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
        registered = []

        async def register(*args, **kwargs):
            if registered:
                raise RuntimeError("simulated output registration failure")
            await register_imported_output(*args, **kwargs)
            registered.append(kwargs["asset_id"])

        if failure == "register":
            monkeypatch.setattr(segment_runner, "register_imported_output", register)
        await VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())._process(
            created["id"]
        )
        task = (await client.get(f"{root}/segment-exports/{created['id']}")).json()
        assert task["status"] == ("cancelled" if failure == "cancel" else "failed"), task
        assert staged_paths and all(not path.exists() for path in staged_paths)
        assert (await client.get("/v1/visual-workshop/projects")).json() == projects_before
        if canvas_before:
            assert (
                await client.get(f"/v1/visual-workshop/projects/{project['id']}/canvas")
            ).json() == canvas_before
        if failure == "register":
            assert len(registered) == 1
            assert "registration failure" in task["error"]
        async with SessionLocal() as session:
            assets = list(
                await session.scalars(
                    select(VisualAsset).where(
                        VisualAsset.video_editor_project_id == created["projectId"]
                    )
                )
            )
            assert len(assets) == 1
            for asset_id in registered:
                assert await session.get(VisualAsset, asset_id) is None
                assert (
                    await session.scalar(
                        select(VisualNodeOutput.id).where(VisualNodeOutput.asset_id == asset_id)
                    )
                ) is None


@pytest.mark.asyncio
async def test_legacy_segment_outputs_can_be_backfilled_through_api(video: bytes) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        root, body = await prepare(client, video)
        body["target"] = {"newProjectTitle": "旧分段画布"}
        created = (await client.post(f"{root}/segment-exports", json=body)).json()
        await VideoEditorRunner(session_factory=SessionLocal, settings=get_settings())._process(
            created["id"]
        )
        completed = (await client.get(f"{root}/segment-exports/{created['id']}")).json()
        project_id = completed["resultDetail"]["targetProjectId"]
        canvas_url = f"/v1/visual-workshop/projects/{project_id}/canvas"
        # Storage fixture in the isolated test database reproduces the old import
        # shape; all repairs below go through the existing business API.
        async with SessionLocal() as session:
            canvas = await session.get(VisualCanvasDocument, project_id)
            nodes = deepcopy(canvas.nodes)
            for node in nodes:
                for field in ("final_output_id", "final_version", "output_sequence"):
                    node.pop(field, None)
            canvas.nodes = nodes
            await session.execute(
                delete(VisualNodeOutput).where(VisualNodeOutput.project_id == project_id)
            )
            await session.commit()
        before = (await client.get(canvas_url)).json()
        revision = before["revision"]
        for node in before["nodes"]:
            output_url = f"/v1/visual-workshop/projects/{project_id}/nodes/{node['id']}/outputs"
            assert (await client.get(output_url)).json()["total"] == 0
            app.dependency_overrides[owner_from_principal] = lambda: "other-workspace"
            try:
                assert (await client.get(output_url)).status_code == 404
                assert (
                    await client.post(
                        output_url,
                        json={"asset_id": node["asset_id"], "expected_revision": revision},
                    )
                ).status_code == 404
            finally:
                app.dependency_overrides.pop(owner_from_principal, None)
            stale = await client.post(
                output_url,
                json={"asset_id": node["asset_id"], "expected_revision": revision - 1},
            )
            assert stale.status_code == 409
            assert (await client.get(output_url)).json()["total"] == 0
            repaired = await client.post(
                output_url, json={"asset_id": node["asset_id"], "expected_revision": revision}
            )
            assert repaired.status_code == 200, repaired.text
            revision = repaired.json()["revision"]
            saved = next(item for item in repaired.json()["nodes"] if item["id"] == node["id"])
            assert saved["asset_id"] == node["asset_id"]
            assert saved["final_version"] == saved["output_sequence"] == 1
            output = (await client.get(output_url)).json()["items"][0]
            assert output["asset_id"] == node["asset_id"]
            assert output["id"] == saved["final_output_id"]
            assert output["is_final"]
        final = (await client.get(canvas_url)).json()
        # A second repair pass only inspects candidates that have no history/final.
        for node in final["nodes"]:
            history = (
                await client.get(
                    f"/v1/visual-workshop/projects/{project_id}/nodes/{node['id']}/outputs"
                )
            ).json()
            assert node["final_output_id"] and history["total"] == 1
        assert (await client.get(canvas_url)).json() == final


def test_segment_filenames_are_portable() -> None:
    assert "/" not in segment_filename("../a/b")
    assert "\\" not in segment_filename("a\\b")
    assert len(segment_filename("镜" * 120).encode()) <= 204
