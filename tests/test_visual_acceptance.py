"""Node acceptance journeys use an isolated database, synthetic media and fake executors."""

import io
import json
import subprocess
from copy import deepcopy

import httpx
import pytest
from PIL import Image
from sqlalchemy import delete

from app.runtime.credentials import encrypt_secret
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.visual_workshop.acceptance.runner import AcceptanceRunner
from studio.apps.visual_workshop.outputs.models import VisualNodeOutput
from studio.apps.visual_workshop.storage.models import VisualGenerationTask
from studio.config.settings import get_settings
from website_test_support import SessionLocal, app


@pytest.fixture
async def client():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        original = {
            row["id"] for row in (await client.get("/v1/visual-workshop/projects")).json()["items"]
        }
        yield client
        for row in (await client.get("/v1/visual-workshop/projects")).json()["items"]:
            if row["id"] not in original:
                result = await client.delete(
                    f"/v1/visual-workshop/projects/{row['id']}",
                    params={"expected_revision": row["revision"]},
                )
                assert result.status_code == 200, result.text
        async with SessionLocal() as session:
            await session.execute(delete(ModelProvider).where(ModelProvider.name == "验收假供应商"))
            await session.commit()


@pytest.fixture
async def configured_model(monkeypatch):
    async with SessionLocal() as session:
        provider = ModelProvider(
            owner_user_id="test-user",
            name="验收假供应商",
            kind="openai",
            base_url="https://example.com/v1",
            api_key_ciphertext=encrypt_secret("fake"),
        )
        session.add(provider)
        await session.flush()
        model = ModelEntry(
            owner_user_id="test-user",
            provider_id=provider.id,
            slug="vision-test",
            label="视觉测试",
            capabilities=["chat", "vision"],
        )
        session.add(model)
        await session.commit()
        identity = model.id
    monkeypatch.setattr(get_settings(), "fpl_acceptance_model_owner_user_id", "test-user")
    monkeypatch.setattr(get_settings(), "fpl_acceptance_model_id", identity)
    return identity


@pytest.fixture
def video(tmp_path):
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
    return path.read_bytes()


async def upload(client, project_id, data, kind):
    response = await client.post(
        "/v1/files",
        data={"project_id": project_id},
        files={
            "upload": (f"reference.{kind}", data, "image/png" if kind == "png" else "video/mp4")
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["id"]


async def setup(client, video, *, references=True, kind="video"):
    response = await client.post(
        "/v1/visual-workshop/projects", json={"title": "节点验收测试", "kind": "canvas"}
    )
    identity = response.json()["id"]
    base = f"/v1/visual-workshop/projects/{identity}"
    buffer = io.BytesIO()
    Image.new("RGB", (64, 64), "blue").save(buffer, "PNG")
    image = await upload(client, identity, buffer.getvalue(), "png")
    motion = await upload(client, identity, video, "mp4")
    # Filenames have no role semantics: explicit reference declarations determine their use.
    draft = {
        "prompt": "原始镜头要求",
        "ratio": "adaptive",
        "duration": -1,
        "mode": "reference",
        "reference_asset_ids": [image] if references else [],
        "video_asset_ids": [motion] if references else [],
    }
    response = await client.put(
        f"{base}/canvas",
        json={
            "expected_revision": 0,
            "nodes": [
                {
                    "id": "shot",
                    "title": "动作镜头",
                    "kind": kind,
                    "position": {"x": 0, "y": 0},
                    **({"generation_draft": draft} if kind == "video" else {}),
                }
            ],
            "edges": [],
        },
    )
    assert response.status_code == 200, response.text
    if kind == "video":
        await add_output(client, base, video)
    return identity, base, image, motion


async def add_output(client, base, video):
    canvas = (await client.get(f"{base}/canvas")).json()
    response = await client.post(
        f"{base}/nodes/shot/output-uploads",
        data={"expected_revision": canvas["revision"]},
        files={"file": ("output.mp4", video, "video/mp4")},
    )
    assert response.status_code == 200, response.text
    return (await client.get(f"{base}/nodes/shot/outputs")).json()["items"][0]


async def context(client, base):
    response = await client.get(f"{base}/nodes/shot/acceptance")
    assert response.status_code == 200, response.text
    return response.json()


async def select_scheme(client, base, scheme="api"):
    value = await context(client, base)
    response = await client.put(
        f"{base}/nodes/shot/acceptance",
        json={"expected_revision": value["revision"], "scheme_id": f"motion-transfer:{scheme}"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def submission(value, request="check", **extra):
    return {
        "expected_revision": value["revision"],
        "expected_canvas_revision": value["canvas_revision"],
        "context_fingerprint": value["context_fingerprint"],
        "output_id": value["output_id"],
        "request_id": request,
        **extra,
    }


async def start(client, base, request="check", **extra):
    value = await context(client, base)
    response = await client.post(
        f"{base}/nodes/shot/acceptance/runs", json=submission(value, request, **extra)
    )
    assert response.status_code == 200, response.text
    return response.json()


def api_transport(*, invalid=False):
    def handle(request):
        content = json.loads(request.content)["messages"][-1]["content"]
        text = next(item["text"] for item in content if item["type"] == "text")
        payload = json.loads(text)
        assert len(payload["evidence"]) >= 4
        results = {
            "results": [
                {
                    "criterion_id": item["id"],
                    "verdict": "passed",
                    "explanation": "仅基于所提供的抽样帧",
                    "evidence_ids": ["fabricated" if invalid else payload["evidence"][0]["id"]],
                }
                for item in payload["criteria"]
            ]
        }
        event = {"choices": [{"delta": {"content": json.dumps(results)}, "finish_reason": "stop"}]}
        return httpx.Response(
            200,
            text="data: " + json.dumps(event) + "\n\ndata: [DONE]\n\n",
            headers={"content-type": "text/event-stream"},
        )

    return httpx.MockTransport(handle)


async def process(client, base, run, **kwargs):
    await AcceptanceRunner(**kwargs, session_factory=SessionLocal, settings=get_settings()).process(
        run["id"]
    )
    return (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()


async def decide(client, base, run, **values):
    response = await client.post(
        f"{base}/acceptance/runs/{run['id']}/decisions",
        json={"expected_revision": run["revision"], **values},
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.asyncio
async def test_readonly_catalog_retired_writes_and_unconfigured_connections(client, video):
    _, base, *_ = await setup(client, video)
    catalog = (await client.get("/v1/visual-workshop/acceptance/catalog")).json()["items"]
    assert len(catalog) == 1 and catalog[0]["title"] == "动作迁移" and catalog[0]["readonly"]
    assert len(catalog[0]["schemes"]) == 6 and not any(
        s["available"] for s in catalog[0]["schemes"]
    )
    document = {"title": "旧标准", "criteria": [], "node_ids": []}
    for method, path, body in [
        (
            "POST",
            "/v1/visual-workshop/acceptance-templates",
            {"expected_revision": 0, "document": document},
        ),
        (
            "PUT",
            f"{base}/acceptance/standard",
            {"expected_revision": 0, "document": document, "publish": True},
        ),
        (
            "POST",
            f"{base}/acceptance/runs",
            {"expected_standard_version": 1, "output_ids": ["old"], "request_id": "old"},
        ),
    ]:
        response = await client.request(method, path, json=body)
        assert response.status_code == 410, response.text
    value = await select_scheme(client, base)
    assert any("固定视觉模型" in message for message in value["issues"])
    response = await client.post(f"{base}/nodes/shot/acceptance/runs", json=submission(value))
    assert response.status_code == 409 and "executor_unavailable" in response.text


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_context_binding_cas_missing_materials_and_context_conflict(client, video):
    _, base, image, motion = await setup(client, video)
    value = await select_scheme(client, base)
    assert value["issues"] == [] and value["input_source"] == "node_settings"
    assert value["specifications"] == {}  # Adaptive duration/ratio are never guessed.
    assert [(i["role"], i["asset_id"]) for i in value["inputs"][:2]] == [
        ("character", image),
        ("motion", motion),
    ]
    stale = await client.put(
        f"{base}/nodes/shot/acceptance",
        json={"expected_revision": 0, "scheme_id": "motion-transfer:api"},
    )
    assert stale.status_code == 409 and "current" in stale.text
    response = await client.post(
        f"{base}/nodes/shot/acceptance/runs",
        json=submission({**value, "context_fingerprint": "0" * 64}),
    )
    assert response.status_code == 409 and "context_changed" in response.text
    _, missing, *_ = await setup(client, video, references=False)
    value = await select_scheme(client, missing)
    assert any("角色基准图" in i for i in value["issues"])
    assert any("原动作视频" in i for i in value["issues"])
    response = await client.post(f"{missing}/nodes/shot/acceptance/runs", json=submission(value))
    assert response.status_code == 422 and "inputs_not_ready" in response.text
    _, image_base, *_ = await setup(client, video, kind="image")
    response = await client.put(
        f"{image_base}/nodes/shot/acceptance",
        json={"expected_revision": 0, "scheme_id": "motion-transfer:api"},
    )
    assert response.status_code == 422


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_model_execution_human_review_repair_recheck_and_independent_adoption(client, video):
    _, base, *_ = await setup(client, video)
    await select_scheme(client, base)
    value = await context(client, base)
    run = await start(client, base)
    replay = await client.post(f"{base}/nodes/shot/acceptance/runs", json=submission(value))
    assert replay.json()["id"] == run["id"]
    changed_request = await client.post(
        f"{base}/nodes/shot/acceptance/runs", json=submission(value, output_id="other")
    )
    assert changed_request.status_code == 409 and "request_conflict" in changed_request.text
    run = await process(client, base, run, transport=api_transport())
    assert run["status"] == "completed", run
    assert run["decision"] == "pending" and run["execution_result"]["kind"] == "model_api"
    assert run["results"][1]["suggestion"] == "passed" and run["results"][1]["verdict"] == "pending"
    finalized = await client.post(
        f"{base}/acceptance/runs/{run['id']}/decisions",
        json={"expected_revision": run["revision"], "finalize": True},
    )
    assert finalized.status_code == 422
    old = deepcopy(run)
    for result in run["results"]:
        if result["verdict"] == "pending":
            run = await decide(
                client,
                base,
                run,
                criterion_id=result["criterion_id"],
                verdict="failed",
                reason="需返修手部姿态",
                start_ms=0,
                end_ms=500,
            )
    run = await decide(client, base, run, finalize=True)
    assert run["decision"] == "failed"
    stale = await client.post(
        f"{base}/acceptance/runs/{run['id']}/decisions",
        json={"expected_revision": old["revision"], "finalize": True},
    )
    assert stale.status_code == 409
    canvas = (await client.get(f"{base}/canvas")).json()
    assert canvas["nodes"][0].get("final_output_id") == run["output_id"]
    adopted = await client.put(
        f"{base}/nodes/shot/final-output",
        json={"expected_revision": canvas["revision"], "output_id": run["output_id"]},
    )
    assert adopted.status_code == 200, adopted.text
    draft = await client.post(f"{base}/acceptance/runs/{run['id']}/repair-drafts", json={})
    assert draft.status_code == 200 and "手部姿态" in draft.json()["text"]
    canvas = (await client.get(f"{base}/canvas")).json()
    saved = await client.put(
        f"{base}/acceptance/repair-drafts/{draft.json()['id']}",
        json={
            "expected_revision": 0,
            "text": draft.json()["text"],
            "apply": True,
            "expected_canvas_revision": canvas["revision"],
        },
    )
    assert saved.status_code == 200, saved.text
    second = await add_output(client, base, video)
    canvas = (await client.get(f"{base}/canvas")).json()
    # Keep v1 as final before reviewing v2: acceptance must not adopt its target.
    adopted = await client.put(
        f"{base}/nodes/shot/final-output",
        json={"expected_revision": canvas["revision"], "output_id": run["output_id"]},
    )
    assert adopted.status_code == 200 and second["id"] != run["output_id"]
    recheck = await start(client, base, "recheck", previous_run_id=run["id"])
    recheck = await process(client, base, recheck, transport=api_transport())
    for result in recheck["results"]:
        if result["verdict"] == "pending":
            recheck = await decide(
                client, base, recheck, criterion_id=result["criterion_id"], verdict="passed"
            )
    await decide(client, base, recheck, finalize=True)
    summary = (await client.get(f"{base}/acceptance/summary")).json()["items"][0]
    assert (
        summary["state"] == "passed"
        and summary["output_version"] == 2
        and summary["final_version"] == 1
    )
    assert (await client.get(f"{base}/acceptance/runs/{run['id']}")).json()["decision"] == "failed"
    evidence = recheck["evidence"][0]
    assert (await client.get(f"/v1/files/{evidence['asset_id']}/content")).status_code == 200
    assert (
        await client.delete(f"/v1/files/{evidence['asset_id']}", params={"expected_revision": 0})
    ).status_code == 409


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_generation_provenance_is_frozen_and_snapshot_import_is_history(client, video):
    identity, base, image, motion = await setup(client, video)
    value = await select_scheme(client, base)
    async with SessionLocal() as session:
        task = VisualGenerationTask(
            owner_user_id="test-user",
            project_id=identity,
            provider_kind="senseaudio_video",
            provider_name="fake",
            generation_kind="video",
            model_slug="fake",
            canvas_node_id="shot",
            status="completed",
            request_payload={
                "prompt": "实际提交的提示词",
                "reference_asset_ids": [image],
                "video_asset_ids": [motion],
                "ratio": "1:1",
                "duration": 1,
            },
        )
        session.add(task)
        await session.flush()
        output = await session.get(VisualNodeOutput, value["output_id"])
        output.generation_task_id = task.id
        await session.commit()
    value = await context(client, base)
    assert value["input_source"] == "generation_snapshot" and value["prompt"] == "实际提交的提示词"
    assert value["specifications"]["ratio"] == "1:1"
    run = await start(client, base)
    canvas = (await client.get(f"{base}/canvas")).json()
    canvas["nodes"][0]["generation_draft"]["prompt"] = "后续修改"
    canvas["nodes"][0]["generation_draft"]["prompt_versions"][0]["prompt"] = "后续修改"
    updated = await client.put(
        f"{base}/canvas",
        json={"expected_revision": canvas["revision"], "nodes": canvas["nodes"], "edges": []},
    )
    assert updated.status_code == 200, updated.text
    assert (await context(client, base))["context_fingerprint"] == value["context_fingerprint"]
    run = await process(client, base, run, transport=api_transport())
    assert run["snapshot"]["prompt"] == "实际提交的提示词"
    export = await client.get(f"{base}/snapshot")
    assert export.status_code == 200, export.text
    imported = await client.post(
        "/v1/visual-workshop/projects/snapshot-imports",
        files={"file": ("snapshot.zip", export.content, "application/zip")},
    )
    assert imported.status_code == 200, imported.text
    imported_base = f"/v1/visual-workshop/projects/{imported.json()['project']['id']}"
    imported_run = (await client.get(f"{imported_base}/acceptance/runs")).json()["items"][0]
    assert (
        imported_run["decision"] == "historical"
        and imported_run["scheme_id"] == "motion-transfer:api"
    )
    assert imported_run["snapshot"]["executor"] == {}
    response = await client.post(
        f"{imported_base}/acceptance/runs/{imported_run['id']}/decisions",
        json={"expected_revision": imported_run["revision"], "finalize": True},
    )
    assert response.status_code == 409 and "historical_readonly" in response.text


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_invalid_result_cancel_recovery_and_workspace_isolation(client, video):
    _, base, *_ = await setup(client, video)
    await select_scheme(client, base)
    invalid = await process(
        client, base, await start(client, base, "invalid"), transport=api_transport(invalid=True)
    )
    assert invalid["status"] == "failed" and invalid["decision"] == "pending"
    queued = await start(client, base, "cancel")
    cancelled = await client.post(
        f"{base}/acceptance/runs/{queued['id']}/cancel?expected_revision={queued['revision']}",
        json={},
    )
    assert cancelled.status_code == 200, cancelled.text
    await AcceptanceRunner(
        transport=api_transport(), session_factory=SessionLocal, settings=get_settings()
    ).process(queued["id"])
    assert (await client.get(f"{base}/acceptance/runs/{queued['id']}")).json()[
        "status"
    ] == "cancelled"
    interrupted = await start(client, base, "interrupted")
    await AcceptanceRunner(session_factory=SessionLocal, settings=get_settings()).recover()
    assert (await client.get(f"{base}/acceptance/runs/{interrupted['id']}")).json()[
        "status"
    ] == "failed"
    from studio.apps.visual_workshop.acceptance.nodes import NodeAcceptance
    from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError

    async with SessionLocal() as session:
        with pytest.raises(AcceptanceError) as failure:
            await NodeAcceptance(session, "other-workspace", "other-user").get(
                base.split("/")[-1], "shot"
            )
        assert failure.value.status == 404


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["codex", "claude-code"])
async def test_agent_task_report_and_scoped_media_with_fake_executor(
    client, video, monkeypatch, kind
):
    from studio.apps.visual_workshop.acceptance.execution import agents
    from studio.apps.visual_workshop.acceptance.execution.task_tools import MediaTools

    async def available(*_):
        return True, "已连接"

    monkeypatch.setattr(agents, "probe", available)
    monkeypatch.setattr("studio.apps.visual_workshop.acceptance.catalog.probe", available)
    prefix = "codex" if kind == "codex" else "claude"
    monkeypatch.setattr(get_settings(), f"fpl_acceptance_{prefix}_executable", "/fake/agent")
    monkeypatch.setattr(get_settings(), f"fpl_acceptance_{prefix}_user_ids", "test-user")
    _, base, *_ = await setup(client, video)
    await select_scheme(client, base, kind)
    roots = []

    async def fake_executor(agent, executable, root, _schema, _tools, prompt, cancelled, **_kwargs):
        assert agent == kind and executable == "/fake/agent" and "不可信数据" in prompt
        assert not await cancelled()
        roots.append(root)
        media = MediaTools(root)
        manifest = await media.manifest()
        image = manifest["evidence"][0]["id"]
        await media.image(image)
        source = next(i for i in manifest["media"] if i["kind"] == "video")
        extra = await media.sample(source["id"], 0, 800, 2)
        extra_id = json.loads(extra[0].text)["evidence_id"]
        return {
            "summary": "仅对抽样画面进行验收",
            "limitations": ["需人工播放核对连续性"],
            "findings": [
                {
                    "criterion_id": c["id"],
                    "suggestion": "passed",
                    "explanation": "参考与输出抽样可辨认",
                    "evidence_ids": [image, extra_id],
                    "start_ms": None,
                    "end_ms": None,
                }
                for c in manifest["task"]["criteria"]
                if c["method"] == "ai"
            ],
        }

    run = await process(client, base, await start(client, base), agent_executor=fake_executor)
    assert run["status"] == "completed", run
    assert run["execution_result"]["kind"] == "code_agent" and run["decision"] == "pending"
    assert run["execution_result"]["report"]["limitations"]
    assert not roots[0].exists()


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_concurrent_retry_freezes_one_run_and_unreadable_references_are_actionable(
    client, video
):
    import asyncio

    _, base, *_ = await setup(client, video)
    value = await select_scheme(client, base)
    responses = await asyncio.gather(
        *[
            client.post(
                f"{base}/nodes/shot/acceptance/runs", json=submission(value, "same-request")
            )
            for _ in range(2)
        ]
    )
    assert all(r.status_code == 200 for r in responses), [r.text for r in responses]
    assert responses[0].json()["id"] == responses[1].json()["id"]
    canvas = (await client.get(f"{base}/canvas")).json()
    canvas["nodes"][0]["generation_draft"]["duration"] = 2
    saved = await client.put(
        f"{base}/canvas",
        json={"expected_revision": canvas["revision"], "nodes": canvas["nodes"], "edges": []},
    )
    assert saved.status_code == 200, saved.text
    value = await context(client, base)
    assert not value["result_is_current"]
    from studio.apps.asset_library.storage.file_paths import AssetStorage
    from studio.apps.asset_library.storage.models import VisualAsset

    async with SessionLocal() as session:
        source = await session.get(VisualAsset, value["inputs"][0]["asset_id"])
        path = AssetStorage(get_settings()).path_for(source)
    backup = path.with_suffix(".unavailable")
    path.rename(backup)
    try:
        value = await context(client, base)
        assert any("参考素材无法读取" in issue for issue in value["issues"])
        response = await client.post(
            f"{base}/nodes/shot/acceptance/runs", json=submission(value, "missing-file")
        )
        assert response.status_code == 422
    finally:
        backup.rename(path)


@pytest.mark.asyncio
@pytest.mark.usefixtures("configured_model")
async def test_queued_execution_revalidates_actor_and_frozen_connection(client, video):
    _, base, *_ = await setup(client, video)
    await select_scheme(client, base)
    run = await start(client, base)

    async def revoked(*_):
        return False

    failed = await process(client, base, run, actor_allowed=revoked, transport=api_transport())
    assert failed["status"] == "failed" and "权限" in failed["error_message"]
    run = await start(client, base, "changed-connection")
    async with SessionLocal() as session:
        model = await session.get(ModelEntry, run["model_id"])
        model.slug = "other-model"
        await session.commit()
    failed = await process(client, base, run, transport=api_transport())
    assert failed["status"] == "failed" and "连接已变化" in failed["error_message"]
