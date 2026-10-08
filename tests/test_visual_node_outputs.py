from copy import deepcopy
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from app.apps.visual_workshop.models import VisualCanvasDocument, VisualWorkshopProject
from app.apps.visual_workshop.outputs.history import (
    NodeOutputs,
    OutputError,
    publish_generated_output,
)
from app.apps.visual_workshop.outputs.models import VisualNodeOutput
from app.main import app
from app.runtime.db import SessionLocal

PNG = b"\x89PNG\r\n\x1a\noutput-version"


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["image", "video", "audio"])
async def test_generation_rejects_own_media_reference(kind):
    from app.apps.visual_workshop.outputs.references import resolve_references
    from app.llm.schemas.generation_tasks import (
        AudioGenerationTaskCreateIn,
        ImageGenerationTaskCreateIn,
        VideoGenerationTaskCreateIn,
    )

    shapes = {
        "image": (ImageGenerationTaskCreateIn, {"reference_asset_ids": ["own"]}),
        "video": (VideoGenerationTaskCreateIn, {"mode": "reference", "video_asset_ids": ["own"]}),
        "audio": (AudioGenerationTaskCreateIn, {"mode": "music", "reference_asset_ids": ["own"]}),
    }
    shape, references = shapes[kind]
    canvas = VisualCanvasDocument(
        project_id="project",
        revision=2,
        nodes=[node("target", kind, "own")],
        edges=[],
    )
    session = AsyncMock()
    session.get.return_value = canvas
    body = shape(
        kind=kind,
        model_id="model",
        prompt="生成",
        canvas_node_id="target",
        expected_canvas_revision=2,
        **references,
    )
    with pytest.raises(OutputError) as error:
        await resolve_references(session, "project", body)
    assert error.value.code == "self_asset_reference"
    assert error.value.status == 422
    # Other files still work, including later edits using a distinct reference.
    canvas.nodes[0]["asset_id"] = "other"
    resolved, _, _ = await resolve_references(session, "project", body)
    assert resolved == body


async def create_project(client):
    response = await client.post(
        "/v1/visual-workshop/projects", json={"title": "AI 娘的日常", "kind": "canvas"}
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


def node(identity, kind="image", asset_id=None):
    result = {"id": identity, "kind": kind, "title": identity, "position": {"x": 0, "y": 0}}
    if kind == "text":
        result["text"] = "小夏的日常"
    else:
        result["asset_id"] = asset_id
    return result


async def save_canvas(client, project_id, nodes, revision=0, edges=None, **fields):
    response = await client.put(
        f"/v1/visual-workshop/projects/{project_id}/canvas",
        json={"nodes": nodes, "edges": edges or [], "expected_revision": revision, **fields},
    )
    assert response.status_code == 200, response.text
    return response.json()


async def upload(client, project_id):
    response = await client.post(
        "/v1/files",
        data={"project_id": project_id},
        files={"upload": ("summer.png", PNG, "image/png")},
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


@pytest.mark.asyncio
async def test_upload_history_final_selection_pagination_cas_and_type_protection():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        asset = await upload(client, project)
        canvas = await save_canvas(client, project, [node("summer", asset_id=asset)])
        base = f"/v1/visual-workshop/projects/{project}/nodes/summer"
        first = (await client.get(base + "/outputs")).json()["items"][0]
        assert first["version"] == 1 and first["is_final"]
        assert canvas["nodes"][0]["final_output_id"] == first["id"]
        appended = await client.post(
            base + "/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("v2.png", PNG, "image/png")},
        )
        assert appended.status_code == 200, appended.text
        canvas = appended.json()
        assert canvas["nodes"][0]["id"] == "summer"
        assert canvas["nodes"][0]["final_version"] == 2
        newest = canvas["nodes"][0]["final_output_id"]
        listing = (await client.get(base + "/outputs", params={"page_size": 1})).json()
        assert listing["total"] == 2 and listing["items"][0]["id"] == newest
        assert (await client.get(base + "/outputs", params={"page_size": 1, "page": 2})).json()[
            "items"
        ][0]["id"] == first["id"]
        assert (await client.get(base + "/outputs/" + first["id"])).json()["is_final"] is False
        # Reading a preview never changes the selected output or revision.
        assert (await client.get(f"/v1/visual-workshop/projects/{project}/canvas")).json() == canvas
        stale = await client.put(
            base + "/final-output", json={"expected_revision": 1, "output_id": first["id"]}
        )
        assert stale.status_code == 409, stale.text
        selected = await client.put(
            base + "/final-output",
            json={"expected_revision": canvas["revision"], "output_id": first["id"]},
        )
        assert selected.status_code == 200, selected.text
        canvas = selected.json()
        assert canvas["nodes"][0]["asset_id"] == asset
        assert canvas["nodes"][0]["final_version"] == 1
        before = (await client.get("/v1/files", params={"project_id": project})).json()["items"]
        bad = await client.post(
            base + "/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("wrong.mp3", b"ID3audio", "audio/mpeg")},
        )
        assert bad.status_code == 422
        assert (await client.get("/v1/files", params={"project_id": project})).json()[
            "items"
        ] == before
        protected = await client.delete(
            base + "/outputs/" + first["id"], params={"expected_revision": canvas["revision"]}
        )
        assert protected.status_code == 409
        removed = await client.delete(
            base + "/outputs/" + newest, params={"expected_revision": canvas["revision"]}
        )
        assert removed.status_code == 200, removed.text
        canvas = removed.json()
        appended = await client.post(
            base + "/outputs", json={"expected_revision": canvas["revision"], "asset_id": asset}
        )
        assert appended.status_code == 200, appended.text
        assert appended.json()["nodes"][0]["final_version"] == 3
        # Project cascade removes histories before deleting its private files.
        deleted = await client.delete(
            f"/v1/visual-workshop/projects/{project}", params={"expected_revision": 0}
        )
        assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_text_context_fixed_references_cycles_and_delete_guards():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        canvas = await save_canvas(client, project, [node("script", "text"), node("image")])
        base = f"/v1/visual-workshop/projects/{project}/nodes/script"
        for text in ["第一版人物描述", "第二版人物描述"]:
            saved = await client.post(
                base + "/outputs", json={"expected_revision": canvas["revision"], "text": text}
            )
            assert saved.status_code == 200, saved.text
            canvas = saved.json()
        versions = (await client.get(base + "/outputs")).json()["items"]
        fixed = {
            "id": "reference",
            "source_node_id": "script",
            "target_node_id": "image",
            "binding": "fixed",
            "output_id": versions[1]["id"],
            "purpose": "context",
        }
        canvas = await save_canvas(client, project, canvas["nodes"], canvas["revision"], [fixed])
        blocked = await client.delete(
            base + "/outputs/" + versions[1]["id"], params={"expected_revision": canvas["revision"]}
        )
        assert blocked.status_code == 409
        deleting_node = await client.put(
            f"/v1/visual-workshop/projects/{project}/canvas",
            json={"expected_revision": canvas["revision"], "nodes": [node("image")], "edges": []},
        )
        assert deleting_node.status_code == 409
        cycle = await client.put(
            f"/v1/visual-workshop/projects/{project}/canvas",
            json={
                "expected_revision": canvas["revision"],
                "nodes": [node("script", "text"), node("image")],
                "edges": [
                    fixed,
                    {"id": "self", "source_node_id": "script", "target_node_id": "script"},
                ],
            },
        )
        assert cycle.status_code == 422
        from app.apps.visual_workshop.outputs.references import resolve_references
        from app.llm.schemas.generation_tasks import ImageGenerationTaskCreateIn

        async with SessionLocal() as session:
            body = ImageGenerationTaskCreateIn(
                kind="image",
                model_id="model",
                prompt="绘制人设",
                canvas_node_id="image",
                expected_canvas_revision=canvas["revision"],
            )
            resolved, _, snapshot = await resolve_references(session, project, body)
            assert "第一版人物描述" in resolved.prompt and "第二版人物描述" not in resolved.prompt
            assert snapshot[0]["output_id"] == versions[1]["id"]
            assert snapshot[0]["version"] == 1
        # An ordinary canvas save can edit draft text without changing committed context.
        edits = deepcopy(canvas["nodes"])
        edits[0]["text"] = "未保存的文本草稿"
        canvas = await save_canvas(client, project, edits, canvas["revision"], [fixed])
        assert canvas["nodes"][0]["final_version"] == 2
        canvas = await save_canvas(client, project, canvas["nodes"], canvas["revision"], [])
        await save_canvas(client, project, [node("image")], canvas["revision"])
        assert (await client.get(base + "/outputs")).status_code == 404


@pytest.mark.asyncio
async def test_generation_publish_is_idempotent_and_preserves_latest_user_edits():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        assets = [await upload(client, project) for _ in range(2)]
        canvas = await save_canvas(client, project, [node("summer", asset_id=assets[0])])
        edited = deepcopy(canvas["nodes"])
        edited[0]["title"] = "用户正在编辑小夏"
        edited[0]["position"] = {"x": 500, "y": 400}
        await save_canvas(client, project, edited, canvas["revision"])
        async with SessionLocal() as session:
            await publish_generated_output(
                session,
                project,
                "summer",
                assets[1],
                "task:mock",
                "mock",
                [{"node_id": "source", "version": 1}],
            )
            await session.commit()
            row = await session.get(VisualCanvasDocument, project)
            revision = row.revision
            assert row.nodes[0]["title"] == "用户正在编辑小夏"
            assert row.nodes[0]["position"] == {"x": 500, "y": 400}
            assert row.nodes[0]["final_version"] == 2
            await publish_generated_output(
                session, project, "summer", assets[1], "task:mock", "mock"
            )
            await session.commit()
            assert row.revision == revision
            assert (
                await session.scalar(
                    select(func.count())
                    .select_from(VisualNodeOutput)
                    .where(VisualNodeOutput.project_id == project)
                )
                == 2
            )
        # User rollback survives a duplicate completion notification.
        final = (
            await client.get(f"/v1/visual-workshop/projects/{project}/nodes/summer/outputs")
        ).json()["items"][-1]
        await client.put(
            f"/v1/visual-workshop/projects/{project}/nodes/summer/final-output",
            json={"expected_revision": revision, "output_id": final["id"]},
        )
        async with SessionLocal() as session:
            await publish_generated_output(
                session, project, "summer", assets[1], "task:mock", "mock"
            )
            await session.commit()
            assert (await session.get(VisualCanvasDocument, project)).nodes[0][
                "asset_id"
            ] == assets[0]


@pytest.mark.asyncio
async def test_background_nodes_avoid_latest_canvas_and_duplicate_completion_does_not_move_them():
    from app.apps.visual_workshop.node_placement import NODE_SIZE

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        assets = [await upload(client, project) for _ in range(2)]
        original = node("original", "text")
        original["position"] = {"x": 80, "y": 80}
        canvas = await save_canvas(client, project, [original])
        async with SessionLocal() as session:
            first = await publish_generated_output(session, project, None, assets[0], "auto:1")
            await session.commit()
            second = await publish_generated_output(session, project, None, assets[1], "auto:2")
            await session.commit()
            current = await session.get(VisualCanvasDocument, project)
            snapshot = deepcopy(current.nodes)
            revision = current.revision
            assert first != second and len(snapshot) == 3
            assert snapshot[0]["position"] == canvas["nodes"][0]["position"]
            for index, a in enumerate(snapshot):
                for b in snapshot[index + 1 :]:
                    assert not (
                        a["position"]["x"] < b["position"]["x"] + NODE_SIZE[b["kind"]]["width"] + 32
                        and a["position"]["x"] + NODE_SIZE[a["kind"]]["width"] + 32
                        > b["position"]["x"]
                        and a["position"]["y"]
                        < b["position"]["y"] + NODE_SIZE[b["kind"]]["height"] + 32
                        and a["position"]["y"] + NODE_SIZE[a["kind"]]["height"] + 32
                        > b["position"]["y"]
                    )
            assert (
                await publish_generated_output(session, project, None, assets[0], "auto:1") == first
            )
            await session.commit()
            assert current.nodes == snapshot and current.revision == revision


@pytest.mark.asyncio
@pytest.mark.parametrize("grid_size", [4, 9])
async def test_generated_grid_placeholders_avoid_existing_cards_and_preserve_task_binding(
    grid_size,
):
    from app.apps.visual_workshop.batch_nodes import attach_grid_nodes
    from app.apps.visual_workshop.generation import VisualGeneration
    from app.apps.visual_workshop.models import VisualGenerationTask
    from app.apps.visual_workshop.node_placement import automatic_node_position

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        originals = [node("root"), node("blocker")]
        originals[1]["position"] = {"x": 352, "y": 0}
        canvas = await save_canvas(client, project, originals)
        async with SessionLocal() as session:
            tasks = [
                VisualGenerationTask(
                    id=str(uuid4()),
                    project_id=project,
                    provider_kind="senseaudio_image",
                    generation_kind="image",
                    provider_name="test",
                    model_slug="test",
                )
                for _ in range(grid_size)
            ]
            session.add_all(tasks)
            await session.flush()
            await attach_grid_nodes(
                VisualGeneration(session),
                project_id=project,
                node_id="root",
                expected_revision=canvas["revision"],
                batch_id="grid",
                task_ids=[task.id for task in tasks],
                grid_size=grid_size,
            )
            await session.commit()
            updated = await session.get(VisualCanvasDocument, project)
            assert len(updated.nodes) == grid_size + 1
            assert [item["position"] for item in updated.nodes[:2]] == [
                item["position"] for item in originals
            ]
            for index, item in enumerate(updated.nodes):
                # A free position is returned unchanged when checked against every other card.
                others = updated.nodes[:index] + updated.nodes[index + 1 :]
                assert (
                    automatic_node_position(others, item["kind"], item["position"])
                    == item["position"]
                )
            for task in tasks:
                await session.refresh(task)
                assert (
                    next(item for item in updated.nodes if item["id"] == task.canvas_node_id)[
                        "generation_task_id"
                    ]
                    == task.id
                )
        removed = await client.delete(
            f"/v1/visual-workshop/projects/{project}", params={"expected_revision": 0}
        )
        assert removed.status_code == 200, removed.text


@pytest.mark.asyncio
async def test_outputs_workspace_scope_and_wrong_node_fixed_reference():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        other = await create_project(client)
        asset = await upload(client, project)
        canvas = await save_canvas(client, project, [node("one", asset_id=asset), node("two")])
        output_id = canvas["nodes"][0]["final_output_id"]
        bad = await client.put(
            f"/v1/visual-workshop/projects/{project}/canvas",
            json={
                "expected_revision": canvas["revision"],
                "nodes": canvas["nodes"],
                "edges": [
                    {
                        "id": "bad",
                        "source_node_id": "two",
                        "target_node_id": "one",
                        "binding": "fixed",
                        "output_id": output_id,
                    }
                ],
            },
        )
        assert bad.status_code == 422
        assert (
            await client.get(f"/v1/visual-workshop/projects/{other}/nodes/one/outputs/{output_id}")
        ).status_code == 404
        async with SessionLocal() as session:
            with pytest.raises(OutputError) as error:
                await NodeOutputs(session, str(uuid4())).list(project, "one", 1, 20)
            assert error.value.status == 404
            assert (await session.get(VisualWorkshopProject, project)).workspace_id == "default"


@pytest.mark.asyncio
async def test_atomic_media_upload_and_snapshot_preserve_full_history_and_fixed_bindings():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        response = await client.post(
            f"/v1/visual-workshop/projects/{project}/node-uploads",
            data={"expected_revision": 0, "x": 240, "y": 120},
            files={"file": ("summer.png", PNG, "image/png")},
        )
        assert response.status_code == 200, response.text
        canvas = response.json()
        material = canvas["nodes"][0]
        assert material["final_version"] == 1 and material["position"] == {"x": 240, "y": 120}
        base = f"/v1/visual-workshop/projects/{project}/nodes/{material['id']}"
        for index in range(2):
            response = await client.post(
                base + "/output-uploads",
                data={"expected_revision": canvas["revision"]},
                files={"file": (f"v{index + 2}.png", PNG, "image/png")},
            )
            assert response.status_code == 200, response.text
            canvas = response.json()
        versions = (await client.get(base + "/outputs")).json()["items"]
        categories = [
            {"id": "character", "name": "人设", "groups": ["主角"]},
            {"id": "scene", "name": "场景", "groups": []},
            {"id": "storyboard", "name": "分镜", "groups": []},
            {"id": "sound", "name": "声音设计", "groups": []},
        ]
        material = canvas["nodes"][0]
        material.update(category_id="character", group="主角", tags=["小夏"])
        edge = {
            "id": "fixed-1",
            "source_node_id": material["id"],
            "target_node_id": "shot",
            "binding": "fixed",
            "output_id": versions[-1]["id"],
        }
        canvas = await save_canvas(
            client,
            project,
            [material, node("shot")],
            canvas["revision"],
            [edge],
            categories=categories,
        )
        response = await client.get(f"/v1/visual-workshop/projects/{project}/snapshot")
        assert response.status_code == 200, response.text
        imported = await client.post(
            "/v1/visual-workshop/projects/snapshot-imports",
            files={"file": ("history.zip", response.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        copied = imported.json()["project"]["id"]
        copied_canvas = (await client.get(f"/v1/visual-workshop/projects/{copied}/canvas")).json()
        assert copied_canvas["categories"] == categories
        copied_node = copied_canvas["nodes"][0]
        assert copied_node["id"] != material["id"]
        assert copied_node["position"] == material["position"] and copied_node["final_version"] == 3
        assert copied_node["group"] == "主角"
        history = (
            await client.get(
                f"/v1/visual-workshop/projects/{copied}/nodes/{copied_node['id']}/outputs"
            )
        ).json()["items"]
        assert [item["version"] for item in history] == [3, 2, 1]
        assert copied_node["final_output_id"] == history[0]["id"]
        assert copied_canvas["edges"][0]["output_id"] == history[-1]["id"]
        assert copied_canvas["edges"][0]["source_node_id"] == copied_node["id"]
        assert {item["asset_id"] for item in history}.isdisjoint(
            {item["asset_id"] for item in versions}
        )


@pytest.mark.asyncio
async def test_composition_registers_one_version_with_frozen_inputs(monkeypatch):
    from app.apps.visual_workshop.generation_runner import VisualGenerationRunner
    from app.runtime.config import get_settings

    calls = []

    def render(paths, captions, output, grid_size):
        calls.append((paths, captions, grid_size))
        output.write_bytes(PNG)

    monkeypatch.setattr("app.apps.visual_workshop.generation_runner.render_image_grid", render)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await create_project(client)
        assets = [await upload(client, project) for _ in range(4)]
        canvas = await save_canvas(
            client,
            project,
            [node(f"image-{index}", asset_id=asset) for index, asset in enumerate(assets)],
        )
        versions = [item["final_output_id"] for item in canvas["nodes"]]
        response = await client.post(
            f"/v1/visual-workshop/projects/{project}/image-compositions",
            json={
                "grid_size": 4,
                "items": [
                    {"node_id": f"image-{index}", "asset_id": asset, "caption": f"镜头 {index}"}
                    for index, asset in enumerate(assets)
                ],
                "expected_canvas_revision": canvas["revision"],
                "result_position": {"x": 600, "y": 600},
                "title": "镜头组合",
            },
        )
        assert response.status_code == 200, response.text
        batch = response.json()
        canvas = (await client.get(f"/v1/visual-workshop/projects/{project}/canvas")).json()
        # Updating the upstream node does not change an already submitted composition.
        changed = await client.post(
            f"/v1/visual-workshop/projects/{project}/nodes/image-0/output-uploads",
            data={"expected_revision": canvas["revision"]},
            files={"file": ("later.png", PNG, "image/png")},
        )
        assert changed.status_code == 200, changed.text
        runner = VisualGenerationRunner(SessionLocal, get_settings())
        await runner._compose_batch(batch["id"])
        await runner._compose_batch(batch["id"])
        listing = (
            await client.get(
                f"/v1/visual-workshop/projects/{project}/nodes/{batch['generation_node_id']}/outputs"
            )
        ).json()
        assert listing["total"] == 1 and len(calls) == 1
        result = listing["items"][0]
        assert result["source"] == "generated" and result["is_final"]
        assert [item["output_id"] for item in result["input_snapshot"]] == versions
        assert [item["version"] for item in result["input_snapshot"]] == [1] * 4
        assert [item["asset_id"] for item in result["input_snapshot"]] == assets
