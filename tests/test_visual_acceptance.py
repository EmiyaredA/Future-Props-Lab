"""Acceptance API journeys use only the isolated test database and synthetic media."""

import io
import json
from copy import deepcopy

import httpx
import pytest
from PIL import Image

from app.apps.visual_workshop.acceptance.models import AcceptanceRun
from app.apps.visual_workshop.acceptance.runner import AcceptanceRunner
from app.main import app
from app.runtime.db import SessionLocal


@pytest.fixture(autouse=True)
async def cleanup_acceptance_projects():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        original = {
            row["id"] for row in (await client.get("/v1/visual-workshop/projects")).json()["items"]
        }
        yield
        for row in (await client.get("/v1/visual-workshop/projects")).json()["items"]:
            if row["id"] not in original:
                result = await client.delete(
                    f"/v1/visual-workshop/projects/{row['id']}",
                    params={"expected_revision": row["revision"]},
                )
                assert result.status_code == 200, result.text
        from sqlalchemy import delete

        from app.llm.models import ModelProvider

        async with SessionLocal() as session:
            await session.execute(delete(ModelProvider).where(ModelProvider.name == "验收假供应商"))
            await session.commit()


async def make_project(client, kind="image"):
    result = await client.post(
        "/v1/visual-workshop/projects", json={"title": "验收测试", "kind": "canvas"}
    )
    assert result.status_code == 200, result.text
    identity = result.json()["id"]
    base = f"/v1/visual-workshop/projects/{identity}"
    state = await client.put(
        f"{base}/canvas",
        json={
            "expected_revision": 0,
            "nodes": [
                {"id": "shot", "title": "测试镜头", "kind": kind, "position": {"x": 0, "y": 0}}
            ],
            "edges": [],
        },
    )
    assert state.status_code == 200, state.text
    return identity, base


def standard_document(method="automatic"):
    return {
        "title": "交付验收",
        "node_ids": ["shot"],
        "criteria": [
            {
                "id": "rule",
                "title": "输出要求",
                "method": method,
                "kinds": ["image"],
                "required": True,
                "requirement": "角色与参考一致",
                "specifications": {"min_width": 64},
            }
        ],
    }


async def publish(client, base, document, required=False, revision=0):
    response = await client.put(
        f"{base}/acceptance/standard",
        json={
            "expected_revision": revision,
            "document": document,
            "publish": True,
            "required": required,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


async def add_output(client, base, project_id, size=64):
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), "red").save(buffer, "PNG")
    asset = await client.post(
        "/v1/files",
        data={"project_id": project_id},
        files={"upload": ("test.png", buffer.getvalue(), "image/png")},
    )
    assert asset.status_code == 200, asset.text
    state = (await client.get(f"{base}/canvas")).json()
    result = await client.post(
        f"{base}/nodes/shot/outputs",
        json={"expected_revision": state["revision"], "asset_id": asset.json()["id"]},
    )
    assert result.status_code == 200, result.text
    output = (await client.get(f"{base}/nodes/shot/outputs")).json()["items"][0]
    return output


async def start(client, base, output, request="check", **extra):
    result = await client.post(
        f"{base}/acceptance/runs",
        json={
            "expected_standard_version": 1,
            "output_ids": [output["id"]],
            "request_id": request,
            **extra,
        },
    )
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


async def process(client, base, run):
    await AcceptanceRunner().process(run["id"])
    return (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()


async def decide(client, base, run, **values):
    result = await client.post(
        f"{base}/acceptance/runs/{run['id']}/decisions",
        json={"expected_revision": run["revision"], **values},
    )
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.asyncio
async def test_strict_candidate_adoption_cas_and_standard_invalidation():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity, base = await make_project(client)
        standard = await publish(client, base, standard_document(), required=True)
        output = await add_output(client, base, identity)
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][0].get("final_output_id") is None
        assert output["is_final"] is False
        rejected = await client.put(
            f"{base}/nodes/shot/final-output",
            json={"output_id": output["id"], "expected_revision": state["revision"]},
        )
        assert rejected.status_code == 409
        forged = deepcopy(state)
        forged["nodes"][0]["approved"] = True
        rejected = await client.put(
            f"{base}/canvas",
            json={"expected_revision": state["revision"], "nodes": forged["nodes"], "edges": []},
        )
        assert rejected.status_code == 409
        run = await start(client, base, output)
        replay = await start(client, base, output)
        assert replay["id"] == run["id"]
        run = await process(client, base, run)
        assert run["status"] == "completed", run
        assert run["results"][0]["verdict"] == "passed"
        stale = deepcopy(run)
        run = await decide(client, base, run, finalize=True)
        assert run["decision"] == "passed"
        rejected = await client.post(
            f"{base}/acceptance/runs/{run['id']}/decisions",
            json={"expected_revision": stale["revision"], "finalize": True},
        )
        assert rejected.status_code == 409
        state = (await client.get(f"{base}/canvas")).json()
        result = await client.put(
            f"{base}/nodes/shot/final-output",
            json={"output_id": output["id"], "expected_revision": state["revision"]},
        )
        assert result.status_code == 200, result.text
        state = (await client.get(f"{base}/canvas")).json()
        state["nodes"][0]["approved"] = True
        approved = await client.put(
            f"{base}/canvas",
            json={"expected_revision": state["revision"], "nodes": state["nodes"], "edges": []},
        )
        assert approved.status_code == 200, approved.text
        run = await decide(
            client, base, run, criterion_id="rule", verdict="failed", reason="复核发现规格不符"
        )
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][0]["approved"] is False
        assert state["nodes"][0]["final_output_id"] == output["id"]
        run = await decide(
            client, base, run, criterion_id="rule", verdict="passed", reason="重新核实通过"
        )
        await decide(client, base, run, finalize=True)
        second = await add_output(client, base, identity)
        assert not second["is_final"]
        assert (await client.get(f"{base}/canvas")).json()["nodes"][0]["final_output_id"] == output[
            "id"
        ]
        await publish(
            client, base, standard_document(), required=True, revision=standard["revision"]
        )
        state = (await client.get(f"{base}/canvas")).json()
        rejected = await client.put(
            f"{base}/nodes/shot/final-output",
            json={"output_id": output["id"], "expected_revision": state["revision"]},
        )
        assert rejected.status_code == 409
        deleted = await client.delete(
            f"{base}/nodes/shot/outputs/{output['id']}",
            params={"expected_revision": state["revision"]},
        )
        assert deleted.status_code == 409


@pytest.mark.asyncio
async def test_manual_problem_repair_recheck_and_snapshot_roundtrip():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity, base = await make_project(client)
        await publish(client, base, standard_document("manual"), required=True)
        output = await add_output(client, base, identity)
        run = await process(client, base, await start(client, base, output))
        result = await client.post(
            f"{base}/acceptance/runs/{run['id']}/decisions",
            json={"expected_revision": run["revision"], "finalize": True},
        )
        assert result.status_code == 422
        run = await decide(
            client,
            base,
            run,
            criterion_id="rule",
            verdict="failed",
            reason="手部结构异常",
            region=[0.1, 0.2, 0.3, 0.4],
        )
        run = await decide(client, base, run, finalize=True)
        assert run["decision"] == "failed"
        draft = await client.post(f"{base}/acceptance/runs/{run['id']}/repair-drafts", json={})
        assert draft.status_code == 200, draft.text
        assert "手部结构异常" in draft.json()["text"]
        new_output = await add_output(client, base, identity)
        new_run = await start(client, base, new_output, "recheck", previous_run_id=run["id"])
        new_run = await process(client, base, new_run)
        new_run = await decide(client, base, new_run, criterion_id="rule", verdict="passed")
        new_run = await decide(client, base, new_run, finalize=True)
        assert new_run["decision"] == "passed"
        assert (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()[
            "decision"
        ] == "failed"
        snapshot = await client.get(f"{base}/snapshot")
        assert snapshot.status_code == 200, snapshot.text
        imported = await client.post(
            "/v1/visual-workshop/projects/snapshot-imports",
            files={"file": ("acceptance.zip", snapshot.content, "application/zip")},
        )
        assert imported.status_code == 200, imported.text
        new_base = f"/v1/visual-workshop/projects/{imported.json()['project']['id']}"
        history = (await client.get(f"{new_base}/acceptance/runs")).json()["items"]
        assert len(history) == 2
        assert all(item["decision"] == "historical" for item in history)
        assert not {item["id"] for item in history} & {run["id"], new_run["id"]}
        deleted = await client.delete(
            base, params={"expected_revision": (await client.get(base)).json()["revision"]}
        )
        assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_template_strips_bindings_and_revision_conflicts():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        document = standard_document("manual")
        document["criteria"][0]["reference_asset_ids"] = ["private-asset"]
        result = await client.post(
            "/v1/visual-workshop/acceptance-templates",
            json={"expected_revision": 0, "document": document},
        )
        assert result.status_code == 200, result.text
        template = result.json()
        assert template["document"]["node_ids"] == []
        assert template["document"]["criteria"][0]["reference_asset_ids"] == []
        result = await client.put(
            f"/v1/visual-workshop/acceptance-templates/{template['id']}",
            json={"expected_revision": 0, "document": document},
        )
        assert result.status_code == 200
        result = await client.delete(
            f"/v1/visual-workshop/acceptance-templates/{template['id']}?expected_revision=0"
        )
        assert result.status_code == 409


@pytest.mark.asyncio
async def test_ai_suggestion_needs_human_confirmation_and_invalid_evidence_fails():
    from app.llm.models import ModelEntry, ModelProvider
    from app.runtime.credentials import encrypt_secret

    async with SessionLocal() as session:
        provider = ModelProvider(
            workspace_id="default",
            name="验收假供应商",
            kind="openai",
            base_url="https://example.com/v1",
            api_key_ciphertext=encrypt_secret("fake-key"),
        )
        session.add(provider)
        await session.flush()
        model = ModelEntry(
            workspace_id="default",
            provider_id=provider.id,
            slug="vision-test",
            label="视觉测试",
            capabilities=["chat", "vision"],
        )
        session.add(model)
        await session.commit()
        model_id = model.id

    def transport(evidence):
        def handle(_request):
            payload = {
                "results": [
                    {
                        "criterion_id": "rule",
                        "verdict": "passed",
                        "explanation": "当前图片符合要求",
                        "evidence_ids": [evidence],
                    }
                ]
            }
            chunk = {
                "choices": [{"delta": {"content": json.dumps(payload)}, "finish_reason": "stop"}]
            }
            return httpx.Response(
                200,
                text="data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n",
                headers={"content-type": "text/event-stream"},
            )

        return httpx.MockTransport(handle)

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity, base = await make_project(client)
        await publish(client, base, standard_document("ai"))
        output = await add_output(client, base, identity)
        run = await start(client, base, output, model_id=model_id)
        await AcceptanceRunner(transport=transport("output")).process(run["id"])
        run = (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()
        assert run["status"] == "completed", run
        assert run["results"][0]["suggestion"] == "passed"
        assert run["results"][0]["verdict"] == "pending"
        invalid = await start(client, base, output, "bad-evidence", model_id=model_id)
        await AcceptanceRunner(transport=transport("fabricated-frame")).process(invalid["id"])
        invalid = (await client.get(f"{base}/acceptance/runs/{invalid['id']}")).json()
        assert invalid["status"] == "failed", invalid
        assert invalid["decision"] == "pending"
        async with SessionLocal() as session:
            row = await session.get(AcceptanceRun, run["id"])
            row.status = "processing"
            await session.commit()
        await AcceptanceRunner().recover()
        assert (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()[
            "status"
        ] == "failed"


@pytest.mark.asyncio
async def test_video_specifications_sampling_and_evidence_protection(tmp_path):
    import subprocess

    from app.capabilities.asset_store.models import VisualAsset
    from app.capabilities.asset_store.storage import AssetStorage
    from app.runtime.config import get_settings

    path = tmp_path / "synthetic.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=red:s=64x64:d=1:r=12",
            "-c:v",
            "libx264",
            "-pix_fmt",
            "yuv420p",
            "-y",
            str(path),
        ],
        check=True,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        identity, base = await make_project(client, "video")
        document = standard_document("automatic")
        document["criteria"][0]["kinds"] = ["video"]
        document["criteria"][0]["specifications"] = {"min_width": 64, "max_duration": 2}
        await publish(client, base, document, required=True)
        state = (await client.get(f"{base}/canvas")).json()
        result = await client.post(
            f"{base}/nodes/shot/output-uploads",
            data={"expected_revision": state["revision"]},
            files={"file": ("synthetic.mp4", path.read_bytes(), "video/mp4")},
        )
        assert result.status_code == 200, result.text
        output = (await client.get(f"{base}/nodes/shot/outputs")).json()["items"][0]
        run = await process(client, base, await start(client, base, output))
        assert run["status"] == "completed", run
        assert run["results"][0]["verdict"] == "passed"
        sampled = await client.post(
            f"{base}/acceptance/runs/{run['id']}/samples",
            json={"expected_revision": run["revision"], "start_ms": 0, "end_ms": 800},
        )
        assert sampled.status_code == 200, sampled.text
        run = sampled.json()
        assert 1 <= len(run["evidence"]) <= 12
        assert [item["position_ms"] for item in run["evidence"]] == sorted(
            {item["position_ms"] for item in run["evidence"]}
        )
        evidence = run["evidence"][0]
        assert (await client.get(f"/v1/files/{evidence['asset_id']}/content")).status_code == 200
        deleted = await client.delete(
            f"/v1/files/{evidence['asset_id']}", params={"expected_revision": 0}
        )
        assert deleted.status_code == 409, deleted.text
        invalid = await client.post(
            f"{base}/acceptance/runs/{run['id']}/samples",
            json={"expected_revision": run["revision"], "start_ms": 0, "end_ms": 2000},
        )
        assert invalid.status_code == 422
        async with SessionLocal() as session:
            source = await session.get(VisualAsset, evidence["asset_id"])
            assert AssetStorage(get_settings()).path_for(source).is_file()
        # Existing output cannot be replaced through legacy canvas JSON either.
        state = (await client.get(f"{base}/canvas")).json()
        state["nodes"][0]["asset_id"] = output["asset_id"]
        result = await client.put(
            f"{base}/canvas",
            json={"expected_revision": state["revision"], "nodes": state["nodes"], "edges": []},
        )
        assert result.status_code == 200, result.text
        assert result.json()["nodes"][0]["final_output_id"] is None


@pytest.mark.asyncio
async def test_workspace_scope_and_unsupported_media_manual_only():
    from sqlalchemy import delete

    from app.apps.visual_workshop.acceptance.models import AcceptanceTemplate
    from app.apps.visual_workshop.models import VisualWorkshopProject
    from app.runtime.ids import new_id

    project_id, template_id = new_id(), new_id()
    async with SessionLocal() as session:
        session.add(
            VisualWorkshopProject(
                id=project_id, workspace_id="other-space", title="不可见", kind="canvas"
            )
        )
        session.add(
            AcceptanceTemplate(
                id=template_id,
                workspace_id="other-space",
                title="不可见模板",
                document=standard_document("manual"),
            )
        )
        await session.commit()
    try:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            assert (
                await client.get(f"/v1/visual-workshop/projects/{project_id}/acceptance/standard")
            ).status_code == 404
            templates = (await client.get("/v1/visual-workshop/acceptance-templates")).json()[
                "items"
            ]
            assert template_id not in {row["id"] for row in templates}
            result = await client.put(
                f"/v1/visual-workshop/acceptance-templates/{template_id}",
                json={"expected_revision": 0, "document": standard_document("manual")},
            )
            assert result.status_code == 404
            identity, base = await make_project(client, "text")
            document = standard_document("ai")
            document["criteria"][0]["kinds"] = ["audio"]
            invalid = await client.put(
                f"{base}/acceptance/standard",
                json={"expected_revision": 0, "document": document, "publish": True},
            )
            assert invalid.status_code == 422
            document["criteria"][0].update(method="manual", kinds=["text"])
            await publish(client, base, document, required=True)
            state = (await client.get(f"{base}/canvas")).json()
            result = await client.post(
                f"{base}/nodes/shot/outputs",
                json={"expected_revision": state["revision"], "text": "候选台词"},
            )
            assert result.status_code == 200, result.text
            assert result.json()["nodes"][0]["text"] == ""
            assert result.json()["nodes"][0]["final_output_id"] is None
    finally:
        async with SessionLocal() as session:
            await session.execute(
                delete(AcceptanceTemplate).where(AcceptanceTemplate.id == template_id)
            )
            await session.execute(
                delete(VisualWorkshopProject).where(VisualWorkshopProject.id == project_id)
            )
            await session.commit()
