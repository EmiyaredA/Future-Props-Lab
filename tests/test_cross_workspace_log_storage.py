"""Log storage fixtures live only in the isolated database created by conftest."""

from contextlib import aclosing
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete

from app.core.db import SessionLocal
from app.models import LlmCallLog
from test_workspace_governance import client_account

pytestmark = pytest.mark.real_auth


@pytest_asyncio.fixture
async def stored_ids():
    ids = [str(uuid4()) for _ in range(3)]
    yield ids
    async with SessionLocal() as session:
        await session.execute(delete(LlmCallLog).where(LlmCallLog.id.in_(ids)))
        await session.commit()


@pytest.mark.asyncio
async def test_scoped_overview_filters_stats_and_private_boundaries(stored_ids):
    admin, _, admin_id, _ = await client_account(admin=True)
    space = await admin.post(
        "/v1/platform/workspaces",
        json={
            "name": f"Log storage {uuid4().hex}",
            "owner_user_id": admin_id,
        },
    )
    assert space.status_code == 201, space.text
    own = space.json()["id"]
    switched = await admin.post("/v1/account/workspaces/switch", json={"workspace_id": own})
    assert switched.status_code == 200, switched.text
    admin.headers["X-CSRF-Token"] = admin.cookies.get("fpl_csrf")
    member, _, _, other = await client_account()
    now = datetime.now(UTC).replace(tzinfo=None)
    ids = stored_ids
    async with SessionLocal() as session:
        for index, (workspace, model, tokens, status, created) in enumerate(
            [
                (own, "scope-model-a", 10, "success", now),
                (other, "scope-model-b", 30, "error", now),
                (other, "scope-model-old", None, "success", now - timedelta(days=2)),
            ]
        ):
            session.add(
                LlmCallLog(
                    id=ids[index],
                    workspace_id=workspace,
                    call_source="thought_workshop_assistant",
                    provider_kind="openai",
                    model=model,
                    trace_id=f"trace-{ids[index]}",
                    total_tokens=tokens,
                    latency_ms=100 * (index + 1),
                    status=status,
                    created_at=created,
                    request_payload={"private": "secret-body"},
                    response_payload={"private": "secret-output"},
                    error_message="private-error",
                )
            )
        await session.commit()
    path = "/v1/account/cross-workspace-call-logs"
    async with aclosing(admin), aclosing(member):
        scope = [("workspace_ids", own), ("workspace_ids", other)]
        response = await admin.get(path, params=[*scope, ("page_size", 1)])
        assert response.status_code == 200, response.text
        data = response.json()
        assert data["total"] == 3 and len(data["items"]) == 1
        assert data["model_options"] == ["scope-model-a", "scope-model-b", "scope-model-old"]
        assert (
            not {"request_payload", "response_payload", "error_message", "trace_id"}
            & data["items"][0].keys()
        )
        for term in (ids[1], f"trace-{ids[1]}", "scope-model-b"):
            result = await admin.get(path, params=[*scope, ("q", term)])
            assert [x["id"] for x in result.json()["items"]] == [ids[1]]
        assert (await admin.get(path, params=[*scope, ("q", "thought_workshop")])).json()[
            "total"
        ] == 3
        filtered = await admin.get(
            path,
            params=[
                *scope,
                ("call_source", "thought_workshop_assistant"),
                ("provider_kind", "openai"),
                ("model", "scope-model-b"),
                ("status", "error"),
                ("from", now.date().isoformat()),
                ("to", now.date().isoformat()),
            ],
        )
        assert filtered.status_code == 200, filtered.text
        assert filtered.json()["total"] == 1
        assert len(filtered.json()["model_options"]) == 3
        assert (await admin.get(path, params=[*scope, ("page_size", 1), ("page", 2)])).json()[
            "items"
        ][0]["id"] != data["items"][0]["id"]
        stats = (await admin.get(path + "/stats", params=scope)).json()
        assert stats == {
            "calls_today": 2,
            "total_tokens_today": 40,
            "avg_latency_ms_today": 150,
            "errors_today": 1,
        }
        assert (await admin.get(path + "/stats", params={"workspace_ids": other})).json()[
            "calls_today"
        ] == 1
        assert (
            await admin.get(path + "/stats", params={"workspace_ids": "missing"})
        ).status_code == 404
        assert (await admin.get(path, params={"workspace_ids": "missing"})).status_code == 404
        assert (await member.get(path, params={"workspace_ids": own})).status_code == 403
        assert (await member.get(path + "/stats", params={"workspace_ids": own})).status_code == 403
        assert (await admin.get(f"/v1/llm-call-logs/{ids[1]}")).status_code == 404
        assert (
            await admin.get(f"/v1/llm-call-logs/{ids[1]}/reproduction-bundle")
        ).status_code == 404
        assert (await admin.delete(f"/v1/llm-call-logs/{ids[1]}")).status_code == 404
        assert (await admin.post("/v1/llm-call-logs/batch-delete", json={"ids": [ids[1]]})).json()[
            "deleted"
        ] == 0
        local = await admin.get(
            "/v1/llm-call-logs", params={"call_source": "thought_workshop_assistant"}
        )
        assert local.status_code == 200, local.text
        assert [x["id"] for x in local.json()["items"]] == [ids[0]]
        for endpoint in (path, "/v1/llm-call-logs"):
            for params in (
                {"status": "invalid"},
                {"from": "wrong"},
                {"from": "2026-09-10", "to": "2026-09-09"},
                {"page_size": 101},
            ):
                assert (await admin.get(endpoint, params=params)).status_code == 422
