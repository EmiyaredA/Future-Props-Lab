"""Real-auth queue acceptance, atomic dispatch and cancellation in the isolated test DB."""

import asyncio
import sys
from contextlib import aclosing, asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from sqlalchemy import delete, select

from app.runtime.credentials import encrypt_secret
from studio.apps.identity.storage.models.accounts import User
from studio.apps.model_service.admission.website_queue import (
    claim_visual_capacity,
    visual_queue_candidates,
)
from studio.apps.model_service.admission.website_quotas import recover_admissions
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.visual_workshop.storage.models import (
    VisualCanvasDocument,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.apps.visual_workshop.website.generation_runner import VisualGenerationRunner
from studio.config.settings import get_settings
from test_workspace_governance import client_account
from website_test_support import SessionLocal

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "sdk/python/src"))

pytestmark = pytest.mark.real_auth


@asynccontextmanager
async def environment(*, queue_limit=20):
    admin, *_ = await client_account(admin=True)
    client, _, user_id, owner_user_id = await client_account()
    provider = ModelProvider(
        id=str(uuid4()),
        owner_user_id=owner_user_id,
        name="Queue test",
        kind="senseaudio_image",
        base_url="https://example.invalid/v1",
        api_key_ciphertext=encrypt_secret("isolated-test-key"),
        enabled=True,
    )
    model = ModelEntry(
        id=str(uuid4()),
        owner_user_id=owner_user_id,
        provider_id=provider.id,
        slug="senseaudio-image-2.0-260319",
        label="Queue test",
        enabled=True,
        capabilities=["image_generation"],
    )
    project = VisualWorkshopProject(
        id=str(uuid4()), owner_user_id=owner_user_id, title="Queue test", kind="image"
    )
    async with SessionLocal() as session:
        session.add_all([provider, project])
        await session.flush()
        session.add(model)
        session.add(VisualCanvasDocument(project_id=project.id, nodes=[], edges=[]))
        await session.commit()
    original = (await admin.get("/v1/platform/runtime-quotas")).json()
    policy = {
        **original["value"],
        "generation_queue": {**original["value"]["generation_queue"], "user": queue_limit},
    }
    result = await admin.patch(
        "/v1/platform/runtime-quotas",
        json={"expected_revision": original["revision"], "value": policy},
    )
    assert result.status_code == 200, result.text
    try:
        yield client, admin, user_id, owner_user_id, project.id, model.id
    finally:
        current = (await admin.get("/v1/platform/runtime-quotas")).json()
        await admin.patch(
            "/v1/platform/runtime-quotas",
            json={"expected_revision": current["revision"], "value": original["value"]},
        )
        async with SessionLocal() as session:
            await session.execute(
                delete(RuntimeAdmission).where(RuntimeAdmission.user_id == user_id)
            )
            await session.execute(
                delete(VisualWorkshopProject).where(
                    VisualWorkshopProject.owner_user_id == owner_user_id
                )
            )
            await session.execute(
                delete(ModelProvider).where(ModelProvider.owner_user_id == owner_user_id)
            )
            await session.commit()
        await client.aclose()
        await admin.aclose()


async def create(client, project_id, model_id, **extra):
    return await client.post(
        f"/v1/visual-workshop/projects/{project_id}/generation-tasks",
        json={"kind": "image", "model_id": model_id, "prompt": "Queue test", **extra},
    )


async def leases(user_id):
    async with SessionLocal() as session:
        return list(
            await session.scalars(
                select(RuntimeAdmission)
                .where(RuntimeAdmission.user_id == user_id, RuntimeAdmission.released_at.is_(None))
                .order_by(RuntimeAdmission.created_at)
            )
        )


def runner():
    return VisualGenerationRunner(
        claim_admission=claim_visual_capacity,
        queue_candidates=visual_queue_candidates,
        session_factory=SessionLocal,
        settings=get_settings(),
    )


@pytest.mark.asyncio
async def test_capacity_overflow_cancel_conflicts_and_workspace_isolation():
    async with environment(queue_limit=1) as (client, _, user, _, project, model):
        first, second, waiting = [(await create(client, project, model)).json() for _ in range(3)]
        rows = await leases(user)
        assert [row.waiting for row in rows] == [False, False, True]
        assert waiting["can_cancel"] and waiting["queue_message"]
        full = await create(client, project, model)
        assert full.status_code == 429 and full.json()["code"] == "generation_queue_full"
        other, *_ = await client_account()
        async with aclosing(other):
            denied = await other.post(
                f"/v1/visual-workshop/generation-tasks/{waiting['id']}/cancel",
                json={"expected_revision": waiting["revision"]},
            )
            assert denied.status_code == 404
        url = f"/v1/visual-workshop/generation-tasks/{waiting['id']}/cancel"
        assert (await client.post(url, json={})).status_code == 422
        stale = await client.post(url, json={"expected_revision": 100})
        assert stale.status_code == 409 and stale.json()["current"]["status"] == "queued"
        cancelled = await client.post(url, json={"expected_revision": waiting["revision"]})
        assert cancelled.status_code == 200, cancelled.text
        assert cancelled.json()["status"] == "cancelled" and not cancelled.json()["can_cancel"]
        assert (await create(client, project, model)).status_code == 200
        assert (await client.get(f"/v1/visual-workshop/generation-tasks/{first['id']}")).json()[
            "status"
        ] == "queued"
        assert second["id"] != first["id"]


@pytest.mark.asyncio
async def test_dispatch_fifo_concurrent_claim_restart_and_cancel_race(monkeypatch):
    submit = AsyncMock(return_value="provider-task")
    monkeypatch.setattr(
        "studio.apps.model_service.generation.visual_submission.submit_generation_task", submit
    )
    monkeypatch.setattr(
        "studio.apps.visual_workshop.website.generation_runner.poll_generation_task",
        AsyncMock(return_value=SimpleNamespace(status="pending", progress=0, execution_info=None)),
    )
    async with environment() as (client, _, user, _, project, model):
        tasks = [(await create(client, project, model)).json() for _ in range(4)]
        worker = runner()
        await worker._process_task(tasks[2]["id"])
        assert submit.await_count == 0
        await worker._fail(tasks[0]["id"], "test terminal")
        await worker._process_task(tasks[3]["id"])
        assert submit.await_count == 0  # A newer task cannot overtake the owner's oldest waiter.
        await asyncio.gather(*(worker._process_task(tasks[2]["id"]) for _ in range(2)))
        assert submit.await_count == 1
        cancelled = await client.post(
            f"/v1/visual-workshop/generation-tasks/{tasks[2]['id']}/cancel",
            json={"expected_revision": tasks[2]["revision"]},
        )
        assert cancelled.status_code == 409 and cancelled.json()["current"]["status"] == "pending"
        await recover_admissions(sessions=SessionLocal)
        await worker.recover()
        assert len(await leases(user)) == 3
        # Queue state survives a new runner instance, without resubmitting accepted work.
        await runner()._process_task(tasks[3]["id"])
        assert submit.await_count == 1
        await worker._fail(tasks[2]["id"], "test terminal")
        # Both cancel and dispatch use a conditional queued transition.
        url = f"/v1/visual-workshop/generation-tasks/{tasks[3]['id']}/cancel"
        response, _ = await asyncio.gather(
            client.post(url, json={"expected_revision": tasks[3]["revision"]}),
            worker._process_task(tasks[3]["id"]),
        )
        final = (await client.get(f"/v1/visual-workshop/generation-tasks/{tasks[3]['id']}")).json()
        assert (response.status_code, final["status"]) in {(200, "cancelled"), (409, "pending")}
        assert submit.await_count == (1 if final["status"] == "cancelled" else 2)


@pytest.mark.asyncio
async def test_grid_all_or_nothing_and_cancelled_batch_finishes_remaining_tasks():
    async with environment(queue_limit=1) as (client, _, _, _, project, model):
        # Two slots + one queue entry cannot accept four child tasks.
        url = f"/v1/visual-workshop/projects/{project}/generation-batches"
        response = await client.post(
            url, json={"model_id": model, "prompt": "Grid", "grid_size": 4}
        )
        assert response.status_code == 429, response.text
        assert (
            await client.get("/v1/visual-workshop/generation-tasks", params={"project_id": project})
        ).json()["total"] == 0
        assert (
            await client.get(
                "/v1/visual-workshop/generation-batches", params={"project_id": project}
            )
        ).json()["total"] == 0
    async with environment(queue_limit=2) as (client, _, user, _, project, model):
        response = await client.post(
            f"/v1/visual-workshop/projects/{project}/generation-batches",
            json={"model_id": model, "prompt": "Grid", "grid_size": 4},
        )
        assert response.status_code == 200, response.text
        batch = response.json()
        assert [r.waiting for r in await leases(user)] == [False, False, True, True]
        child = batch["child_task_ids"][-1]
        assert (
            await client.post(
                f"/v1/visual-workshop/generation-tasks/{child}/cancel",
                json={"expected_revision": 0},
            )
        ).status_code == 200
        worker = runner()
        await worker._refresh_batches()
        assert (await client.get(f"/v1/visual-workshop/generation-batches/{batch['id']}")).json()[
            "status"
        ] == "processing"
        for identity in batch["child_task_ids"][:-1]:
            await worker._fail(identity, "deterministic terminal")
        await worker._refresh_batches()
        result = (await client.get(f"/v1/visual-workshop/generation-batches/{batch['id']}")).json()
        assert result["status"] == "cancelled" and result["cancelled_count"] == 1
        assert result["failed_count"] == 3


@pytest.mark.asyncio
async def test_zero_and_lowered_queue_limit_preserve_accepted_tasks():
    async with environment(queue_limit=0) as (client, _, _, _, project, model):
        for _ in range(2):
            assert (await create(client, project, model)).status_code == 200
        assert (await create(client, project, model)).status_code == 429
    async with environment(queue_limit=2) as (client, admin, _, _, project, model):
        tasks = [(await create(client, project, model)).json() for _ in range(4)]
        state = (await admin.get("/v1/platform/runtime-quotas")).json()
        state["value"]["generation_queue"]["user"] = 0
        assert (
            await admin.patch(
                "/v1/platform/runtime-quotas",
                json={"expected_revision": state["revision"], "value": state["value"]},
            )
        ).status_code == 200
        assert (await create(client, project, model)).status_code == 429
        await runner()._fail(tasks[0]["id"], "test terminal")
        assert tasks[2]["id"] in await visual_queue_candidates(SessionLocal)


@pytest.mark.asyncio
@pytest.mark.parametrize("invalid", ["account", "model"])
async def test_waiting_task_rechecks_execution_authorization(invalid, monkeypatch):
    submit = AsyncMock(return_value="should-not-submit")
    monkeypatch.setattr(
        "studio.apps.model_service.generation.visual_submission.submit_generation_task", submit
    )
    monkeypatch.setattr(
        "studio.apps.visual_workshop.website.generation_runner.poll_generation_task",
        AsyncMock(return_value=SimpleNamespace(status="pending", progress=0, execution_info=None)),
    )
    async with environment() as (client, _, user, workspace, project, model):
        task = (await create(client, project, model)).json()
        async with SessionLocal() as session:
            if invalid == "account":
                row = await session.get(User, user)
                row.status = "disabled"
            else:
                row = await session.get(ModelEntry, model)
                row.enabled = False
            await session.commit()
        worker = runner()
        await worker._process_task(task["id"])
        async with SessionLocal() as session:
            result = await session.get(VisualGenerationTask, task["id"])
            assert result.status == "failed" and result.error_message
        assert submit.await_count == 0


@pytest.mark.asyncio
async def test_competing_creates_cannot_exceed_running_or_waiting_capacity():
    async with environment(queue_limit=1) as (client, _, user, _, project, model):
        responses = await asyncio.gather(*(create(client, project, model) for _ in range(8)))
        assert sorted(r.status_code for r in responses) == [200, 200, 200, 429, 429, 429, 429, 429]
        rows = await leases(user)
        assert len(rows) == 3 and sum(row.waiting for row in rows) == 1


@pytest.mark.asyncio
async def test_long_blocked_queue_does_not_starve_other_owners_or_polling(monkeypatch):
    monkeypatch.setattr(
        "studio.apps.model_service.generation.visual_submission.submit_generation_task",
        AsyncMock(return_value="provider-task"),
    )
    monkeypatch.setattr(
        "studio.apps.visual_workshop.website.generation_runner.poll_generation_task",
        AsyncMock(return_value=SimpleNamespace(status="pending", progress=1, execution_info=None)),
    )
    async with environment(queue_limit=50) as (client, _, _, _, project, model):
        # More blocked waiters than the polling page size.
        for _ in range(43):
            assert (await create(client, project, model)).status_code == 200
        other, _, user_id, owner_user_id = await client_account()
        async with aclosing(other):
            async with SessionLocal() as session:
                other_project = VisualWorkshopProject(
                    owner_user_id=owner_user_id, title="Other owner", kind="image"
                )
                session.add(other_project)
                await session.flush()
                identity = other_project.id
                # This test seeds a task directly in its isolated storage to give it a
                # provider while preserving normal admission through the actual API.
                provider = ModelProvider(
                    owner_user_id=owner_user_id,
                    name="Other queue test",
                    kind="senseaudio_image",
                    base_url="https://example.invalid/v1",
                    api_key_ciphertext=encrypt_secret("test-key"),
                    enabled=True,
                )
                session.add(provider)
                await session.flush()
                entry = ModelEntry(
                    owner_user_id=owner_user_id,
                    provider_id=provider.id,
                    slug="senseaudio-image-2.0-260319",
                    enabled=True,
                    capabilities=["image_generation"],
                )
                session.add(entry)
                await session.commit()
                model_id = entry.id
            task = (await create(other, identity, model_id)).json()
            try:
                assert task["id"] in await visual_queue_candidates(SessionLocal)
                worker = runner()
                await worker._process_task(task["id"])
                seen = []

                async def observe(task_id):
                    seen.append(task_id)

                worker._process_task = observe
                await worker.process_once()
                assert seen[0] == task["id"]  # Submitted work is polled before waiters.
            finally:
                async with SessionLocal() as session:
                    await session.execute(
                        delete(RuntimeAdmission).where(RuntimeAdmission.user_id == user_id)
                    )
                    await session.execute(
                        delete(VisualWorkshopProject).where(VisualWorkshopProject.id == identity)
                    )
                    await session.execute(
                        delete(ModelProvider).where(ModelProvider.id == provider.id)
                    )
                    await session.commit()


@pytest.mark.asyncio
async def test_account_queue_shared_across_projects_and_sdk():
    import httpx
    from future_props_lab import ApiError, AsyncClient

    from website_test_support import app

    async with environment(queue_limit=1) as (client, admin, user, workspace, project, model):
        for _ in range(3):
            assert (await create(client, project, model)).status_code == 200
        second = workspace
        async with SessionLocal() as session:
            provider = ModelProvider(
                owner_user_id=second,
                name="SDK queue",
                kind="senseaudio_video",
                api_key_ciphertext=encrypt_secret("test-key"),
                base_url="https://example.invalid/v1",
            )
            session.add(provider)
            await session.flush()
            entry = ModelEntry(
                owner_user_id=second,
                provider_id=provider.id,
                slug="doubao-seedance-2-0-260128",
                enabled=True,
                capabilities=["video_generation"],
            )
            other_project = VisualWorkshopProject(
                owner_user_id=second, title="SDK queue", kind="video"
            )
            session.add_all([entry, other_project])
            await session.commit()
        key = await client.post(
            "/v1/account/api-keys",
            json={
                "name": "Queue SDK",
                "scopes": ["studio:read", "studio:write"],
                "expires_in_days": 1,
            },
        )
        assert key.status_code == 201, key.text
        try:
            async with AsyncClient(
                base_url="http://test",
                api_key=key.json()["secret"],
                transport=httpx.ASGITransport(app=app),
            ) as sdk:
                with pytest.raises(ApiError) as failure:
                    await sdk.generation.create_generation_task(
                        project_id=other_project.id,
                        body={"kind": "video", "model_id": entry.id, "prompt": "SDK queue"},
                    )
                assert failure.value.status == 429
                assert failure.value.code == "generation_queue_full"
                # Release the same account's older waiting entry via its original workspace.
                tasks = (
                    await client.get(
                        "/v1/visual-workshop/generation-tasks", params={"project_id": project}
                    )
                ).json()["items"]
                waiting_id = tasks[0]["id"]
                assert (
                    await client.post(
                        f"/v1/visual-workshop/generation-tasks/{waiting_id}/cancel",
                        json={"expected_revision": 0},
                    )
                ).status_code == 200
                task = await sdk.generation.create_generation_task(
                    project_id=other_project.id,
                    body={"kind": "video", "model_id": entry.id, "prompt": "SDK queue"},
                )
                cancelled = await sdk.generation.cancel_generation_task(
                    task_id=task.id, body={"expected_revision": task.revision}
                )
                assert cancelled.status == "cancelled"
        finally:
            async with SessionLocal() as session:
                await session.execute(
                    delete(RuntimeAdmission).where(RuntimeAdmission.owner_user_id == second)
                )
                await session.execute(
                    delete(VisualWorkshopProject).where(
                        VisualWorkshopProject.owner_user_id == second
                    )
                )
                await session.execute(
                    delete(ModelProvider).where(ModelProvider.owner_user_id == second)
                )
                await session.commit()


@pytest.mark.asyncio
async def test_provider_timeout_excludes_local_waiting_time(monkeypatch):
    from dataclasses import replace
    from datetime import timedelta

    from studio.runtime.time import utc_now

    poll = AsyncMock(return_value=SimpleNamespace(status="pending", progress=0))
    monkeypatch.setattr("studio.apps.visual_workshop.website.generation_runner.get_task", poll)
    async with environment() as (client, _, _, _, project, model):
        task = (await create(client, project, model)).json()
        async with SessionLocal() as session:
            row = await session.get(VisualGenerationTask, task["id"])
            row.status = "pending"
            row.created_at = utc_now() - timedelta(hours=2)
            row.submitted_at = utc_now()
            row.provider_task_id = "remote"
            await session.commit()
        worker = runner()
        context = await worker.task_store.claim(task["id"])
        result = await worker._poll_context(replace(context, provider_kind="zealman_video"))
        assert result.status == "pending" and poll.await_count == 1


@pytest.mark.asyncio
async def test_full_grid_rejection_rolls_back_canvas_cas_and_placeholder_nodes():
    async with environment(queue_limit=1) as (client, _, user, _, project, model):
        canvas_url = f"/v1/visual-workshop/projects/{project}/canvas"
        saved = await client.put(
            canvas_url,
            json={
                "expected_revision": 0,
                "nodes": [
                    {"id": "image", "kind": "image", "title": "Grid", "position": {"x": 0, "y": 0}}
                ],
                "edges": [],
            },
        )
        assert saved.status_code == 200, saved.text
        response = await client.post(
            f"/v1/visual-workshop/projects/{project}/generation-batches",
            json={
                "model_id": model,
                "prompt": "Grid",
                "grid_size": 4,
                "grid_output": "nodes",
                "canvas_node_id": "image",
                "expected_canvas_revision": saved.json()["revision"],
            },
        )
        assert response.status_code == 429, response.text
        assert (await client.get(canvas_url)).json() == saved.json()
        assert await leases(user) == []
