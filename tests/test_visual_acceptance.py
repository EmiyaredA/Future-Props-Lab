"""Acceptance API journeys use only the isolated test database and synthetic media."""
import io
import json
from copy import deepcopy

import httpx
import pytest
from PIL import Image
from sqlalchemy import select

from app.apps.visual_workshop.acceptance.models import AcceptanceRun
from app.apps.visual_workshop.acceptance.runner import AcceptanceRunner
from app.main import app
from app.runtime.db import SessionLocal


async def make_project(client, kind="image"):
    result = await client.post("/v1/visual-workshop/projects", json={"title": "验收测试", "kind": "canvas"})
    assert result.status_code == 200, result.text
    identity = result.json()["id"]
    base = f"/v1/visual-workshop/projects/{identity}"
    state = await client.put(f"{base}/canvas", json={"expected_revision": 0, "nodes": [{"id": "shot", "title": "测试镜头", "kind": kind, "position": {"x": 0, "y": 0}}], "edges": []})
    assert state.status_code == 200, state.text
    return identity, base


def standard_document(method="automatic"):
    return {"title": "交付验收", "node_ids": ["shot"], "criteria": [
        {"id": "rule", "title": "输出要求", "method": method, "kinds": ["image"],
         "required": True, "requirement": "角色与参考一致", "specifications": {"min_width": 64}}]}


async def publish(client, base, document, required=False, revision=0):
    response = await client.put(f"{base}/acceptance/standard", json={"expected_revision": revision, "document": document, "publish": True, "required": required})
    assert response.status_code == 200, response.text
    return response.json()


async def add_output(client, base, project_id, size=64):
    buffer = io.BytesIO()
    Image.new("RGB", (size, size), "red").save(buffer, "PNG")
    asset = await client.post("/v1/files", data={"project_id": project_id}, files={"upload": ("test.png", buffer.getvalue(), "image/png")})
    assert asset.status_code == 200, asset.text
    state = (await client.get(f"{base}/canvas")).json()
    result = await client.post(f"{base}/nodes/shot/outputs", json={"expected_revision": state["revision"], "asset_id": asset.json()["id"]})
    assert result.status_code == 200, result.text
    output = (await client.get(f"{base}/nodes/shot/outputs")).json()["items"][0]
    return output


async def start(client, base, output, request="check", **extra):
    result = await client.post(f"{base}/acceptance/runs", json={"expected_standard_version": 1, "output_ids": [output["id"]], "request_id": request, **extra})
    assert result.status_code == 200, result.text
    return result.json()["items"][0]


async def process(client, base, run):
    await AcceptanceRunner().process(run["id"])
    return (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()


async def decide(client, base, run, **values):
    result = await client.post(f"{base}/acceptance/runs/{run['id']}/decisions", json={"expected_revision": run["revision"], **values})
    assert result.status_code == 200, result.text
    return result.json()


@pytest.mark.asyncio
async def test_strict_candidate_adoption_cas_and_standard_invalidation():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        identity, base = await make_project(client)
        standard = await publish(client, base, standard_document(), required=True)
        output = await add_output(client, base, identity)
        state = (await client.get(f"{base}/canvas")).json()
        assert state["nodes"][0].get("final_output_id") is None
        assert output["is_final"] is False
        rejected = await client.put(f"{base}/nodes/shot/final-output", json={"output_id": output["id"], "expected_revision": state["revision"]})
        assert rejected.status_code == 409
        forged = deepcopy(state)
        forged["nodes"][0]["approved"] = True
        rejected = await client.put(f"{base}/canvas", json={"expected_revision": state["revision"], "nodes": forged["nodes"], "edges": []})
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
        rejected = await client.post(f"{base}/acceptance/runs/{run['id']}/decisions", json={"expected_revision": stale["revision"], "finalize": True})
        assert rejected.status_code == 409
        state = (await client.get(f"{base}/canvas")).json()
        result = await client.put(f"{base}/nodes/shot/final-output", json={"output_id": output["id"], "expected_revision": state["revision"]})
        assert result.status_code == 200, result.text
        second = await add_output(client, base, identity)
        assert not second["is_final"]
        assert (await client.get(f"{base}/canvas")).json()["nodes"][0]["final_output_id"] == output["id"]
        await publish(client, base, standard_document(), required=True, revision=standard["revision"])
        state = (await client.get(f"{base}/canvas")).json()
        rejected = await client.put(f"{base}/nodes/shot/final-output", json={"output_id": output["id"], "expected_revision": state["revision"]})
        assert rejected.status_code == 409
        deleted = await client.delete(f"{base}/nodes/shot/outputs/{output['id']}", params={"expected_revision": state["revision"]})
        assert deleted.status_code == 409


@pytest.mark.asyncio
async def test_manual_problem_repair_recheck_and_snapshot_roundtrip():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        identity, base = await make_project(client)
        await publish(client, base, standard_document("manual"), required=True)
        output = await add_output(client, base, identity)
        run = await process(client, base, await start(client, base, output))
        result = await client.post(f"{base}/acceptance/runs/{run['id']}/decisions", json={"expected_revision": run["revision"], "finalize": True})
        assert result.status_code == 422
        run = await decide(client, base, run, criterion_id="rule", verdict="failed", reason="手部结构异常", region=[0.1, 0.2, 0.3, 0.4])
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
        assert (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()["decision"] == "failed"
        snapshot = await client.get(f"{base}/snapshot")
        assert snapshot.status_code == 200, snapshot.text
        imported = await client.post("/v1/visual-workshop/projects/snapshot-imports", files={"file": ("acceptance.zip", snapshot.content, "application/zip")})
        assert imported.status_code == 200, imported.text
        new_base = f"/v1/visual-workshop/projects/{imported.json()['project']['id']}"
        history = (await client.get(f"{new_base}/acceptance/runs")).json()["items"]
        assert len(history) == 2
        assert all(item["decision"] == "historical" for item in history)
        assert not {item["id"] for item in history} & {run["id"], new_run["id"]}
        state = (await client.get(f"{base}/canvas")).json()
        deleted = await client.delete(base, params={"expected_revision": (await client.get(base)).json()["revision"]})
        assert deleted.status_code == 200, deleted.text


@pytest.mark.asyncio
async def test_template_strips_bindings_and_revision_conflicts():
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        document = standard_document("manual")
        document["criteria"][0]["reference_asset_ids"] = ["private-asset"]
        result = await client.post("/v1/visual-workshop/acceptance-templates", json={"expected_revision": 0, "document": document})
        assert result.status_code == 200, result.text
        template = result.json()
        assert template["document"]["node_ids"] == []
        assert template["document"]["criteria"][0]["reference_asset_ids"] == []
        result = await client.put(f"/v1/visual-workshop/acceptance-templates/{template['id']}", json={"expected_revision": 0, "document": document})
        assert result.status_code == 200
        result = await client.delete(f"/v1/visual-workshop/acceptance-templates/{template['id']}?expected_revision=0")
        assert result.status_code == 409


@pytest.mark.asyncio
async def test_ai_suggestion_needs_human_confirmation_and_invalid_evidence_fails():
    from app.llm.models import ModelEntry, ModelProvider
    from app.runtime.credentials import encrypt_secret
    async with SessionLocal() as session:
        provider = ModelProvider(workspace_id="default", name="验收假供应商", kind="openai", base_url="https://example.com/v1", api_key_ciphertext=encrypt_secret("fake-key"))
        session.add(provider)
        await session.flush()
        model = ModelEntry(workspace_id="default", provider_id=provider.id, slug="vision-test", label="视觉测试", capabilities=["chat", "vision"])
        session.add(model)
        await session.commit()
        model_id = model.id
    def transport(evidence):
        def handle(request):
            payload = {"results": [{"criterion_id": "rule", "verdict": "passed", "explanation": "当前图片符合要求", "evidence_ids": [evidence]}]}
            chunk = {"choices": [{"delta": {"content": json.dumps(payload)}, "finish_reason": "stop"}]}
            return httpx.Response(200, text="data: " + json.dumps(chunk) + "\n\ndata: [DONE]\n\n", headers={"content-type": "text/event-stream"})
        return httpx.MockTransport(handle)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
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
        assert (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()["status"] == "failed"
