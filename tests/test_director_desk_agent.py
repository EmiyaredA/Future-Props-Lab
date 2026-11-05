import asyncio
from uuid import uuid4

import httpx
import pytest
from tests.account_fixtures import account_record

from app.console.governance.automation_access import MANIFEST
from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_owner
from studio.contracts.identity.principal import StudioPrincipal

ROOT = "/v1/director-desk/projects"
TOKEN = "director-agent-test-token"


async def _viewer(session: SessionDep) -> StudioPrincipal:
    bind_owner(session, "test-user")
    return StudioPrincipal(
        platform_role="admin",
        user_id="test-user",
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read"}),
        session_id="test-session",
    )


async def _create(client: httpx.AsyncClient) -> dict:
    created = await client.post(ROOT, json={"title": "外部接入"})
    assert created.status_code == 201, created.text
    return created.json()


@pytest.mark.asyncio
async def test_tool_call_requires_open_editor_and_does_not_write_scene():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await _create(client)
        url = f"{ROOT}/{project['id']}"
        denied = await client.post(
            f"{url}/tools",
            json={"name": "director_apply", "arguments": {}, "request_id": "missing"},
        )
        assert denied.status_code == 409, denied.text
        assert denied.json()["code"] == "editor_not_open"
        assert (await client.get(url)).json()["document"]["scenes"] == []


@pytest.mark.asyncio
async def test_open_editor_runs_tool_once_per_request_id():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await _create(client)
        url = f"{ROOT}/{project['id']}"
        claimed = await client.post(f"{url}/agent-session")
        assert claimed.status_code == 200, claimed.text
        session_id = claimed.json()["session_id"]

        async def editor():
            polled = await client.get(
                f"{url}/agent-session/calls",
                params={"session_id": session_id, "wait": 5},
            )
            assert polled.status_code == 200, polled.text
            call = polled.json()["call"]
            assert call["name"] == "director_read"
            assert call["request_id"] == "read-1"
            done = await client.post(
                f"{url}/agent-session/calls/{call['id']}",
                json={"session_id": session_id, "result": {"revision": 7}},
            )
            assert done.status_code == 200, done.text

        editor_task = asyncio.create_task(editor())
        body = {
            "name": "director_read",
            "arguments": {"sections": ["scene"]},
            "request_id": "read-1",
        }
        called = await client.post(f"{url}/tools", json=body)
        assert called.status_code == 200, called.text
        assert called.json()["result"] == {"revision": 7}
        await editor_task
        again = await client.post(f"{url}/tools", json=body)
        assert again.status_code == 200, again.text
        assert again.json()["result"] == {"revision": 7}
        quiet = await client.get(
            f"{url}/agent-session/calls",
            params={"session_id": session_id, "wait": 0},
        )
        assert quiet.status_code == 200, quiet.text
        assert quiet.json()["call"] is None
        released = await client.delete(f"{url}/agent-session", params={"session_id": session_id})
        assert released.status_code == 200


@pytest.mark.asyncio
async def test_other_workspace_tool_call_is_missing():
    from app.runtime.db import SessionLocal
    from studio.apps.director_desk.storage.models import DirectorDeskProject

    project_id = str(uuid4())
    other = str(uuid4())
    async with SessionLocal() as session:
        session.add(account_record(id=other, name="隔离工具"))
        await session.flush()
        session.add(
            DirectorDeskProject(
                id=project_id,
                owner_user_id=other,
                title="隔离工程",
                document={
                    "format": "director-desk",
                    "version": 3,
                    "name": "隔离工程",
                    "resources": [],
                    "scenes": [],
                },
            )
        )
        await session.commit()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            f"{ROOT}/{project_id}/tools",
            json={"name": "director_read", "arguments": {}, "request_id": "cross"},
        )
        assert response.status_code == 404


@pytest.mark.asyncio
async def test_read_only_principal_cannot_mutate_scene():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = await _create(client)
        app.dependency_overrides[require_studio_auth] = _viewer
        denied = await client.post(
            f"{ROOT}/{project['id']}/tools",
            json={"name": "director_apply", "arguments": {"operations": []}, "request_id": "ro"},
        )
        assert denied.status_code == 403, denied.text
        assert denied.json()["code"] == "insufficient_permission"


def test_automation_allowlist_hides_editor_session_and_allows_tool_call():
    operations = MANIFEST["operations"]
    assert "POST /v1/director-desk/projects/{project_id}/agent-session" not in operations
    assert "POST /v1/director-desk/projects/{project_id}/tools" in operations
    assert "GET /v1/director-desk/projects" in operations
