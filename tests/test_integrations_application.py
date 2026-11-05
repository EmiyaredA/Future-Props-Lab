"""Owned Integration HTTP, validation capacity, uncertainty and account boundaries."""

import asyncio
import io
import json
import os
import subprocess
import sys
import time
import zipfile
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from app.integrations.mcp.client import DiscoveredTool, DiscoveryResult
from studio.apps.integrations.records import ValidationAttempt
from studio.apps.integrations.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.integrations.application import create_app
from studio.config.settings import Settings, get_settings
from studio.contracts.gateway.protocol_hash import public_contract
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.integrations.integration_intents import (
    IntegrationDecision,
    IntegrationIntentReceipt,
)
from studio.runtime.database.migrations import apply


class Ports:
    def __init__(self):
        self.scopes = {}
        self.actor = None
        self.active_value = True
        self.changes = []
        self.wait = False
        self.calls = 0
        self.entered = asyncio.Event()
        self.closed = asyncio.Event()

    async def status(self, **_kwargs):
        return self.active_value

    async def active(self, **_kwargs):
        return self.active_value

    async def enroll(self, **values):
        intent = uuid4()
        self.scopes[str(intent)] = values["scope"]
        return IntegrationIntentReceipt(id=intent, fingerprint="a" * 64, scope=values["scope"])

    async def check(self, intent_id):
        return IntegrationDecision(
            allowed=self.active_value,
            expires_at=int(time.time()) + 5,
            actor=self.actor,
            scope=self.scopes[str(intent_id)],
        )

    async def change(self, intent_id, operation, *, outcome=None):
        self.changes.append((str(intent_id), operation, outcome))

    async def discover(self, **_kwargs):
        self.calls += 1
        self.entered.set()
        try:
            if self.wait:
                await asyncio.Event().wait()
            return DiscoveryResult(
                "owned", "1", "2025-06-18", (DiscoveredTool("safe", "test", {}),)
            )
        finally:
            self.closed.set()

    async def tool_reply(self, tool, inputs):
        return {"tool": tool, "seen": inputs}

    async def close(self):
        pass


@pytest.fixture
async def case(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_DATABASE_PATH", str(tmp_path / "service.db"))
    get_settings.cache_clear()
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(tmp_path / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    apply(settings.database_path, "integrations", MIGRATIONS)
    key = Ed25519PrivateKey.generate()
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    port = Ports()
    app = create_app(
        settings=settings,
        catalog=catalog,
        public_key=key.public_key(),
        identity=port,
        intents=port,
        capacity=port,
        mcp_client=port,
        demo_tools=port.tool_reply,
        run_tasks=False,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            def headers(method, path, owner="alpha"):
                actor = Actor(
                    user_id=owner,
                    platform_role="user",
                    auth_kind="session",
                    scopes=tuple(sorted(role_scopes("user"))),
                    session_id="session-" + owner,
                )
                port.actor = actor
                return {
                    "x-fpl-context": issue_context(
                        actor,
                        service="integrations",
                        method=method,
                        path=path,
                        private_key=key,
                        key_id="test",
                    )
                }

            async def call(method, path, *, owner="alpha", **kwargs):
                return await client.request(
                    method, path, headers=headers(method, path, owner), **kwargs
                )

            yield SimpleNamespace(
                app=app, port=port, client=client, call=call, catalog=catalog, settings=settings
            )
    get_settings.cache_clear()


async def create_mcp(case):
    response = await case.call(
        "POST",
        "/v1/integrations/mcp",
        json={
            "name": "Owned MCP",
            "transport": "streamable_http",
            "url": "https://example.com/mcp",
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


async def test_owned_catalog_validation_capability_and_public_contract(case):
    id = await create_mcp(case)
    path = f"/v1/integrations/mcp/{id}/validate"
    response = await case.call("POST", path)
    assert response.status_code == 200, response.text
    assert response.json()["check"]["ok"] is True
    assert case.port.calls == 1
    assert [change[1:] for change in case.port.changes] == [
        ("acquire", None),
        ("release", "completed"),
    ]
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        attempt = await session.scalar(select(ValidationAttempt))
        assert attempt.status == "completed" and attempt.released
        assert "assertion" not in attempt.scope
    denied = await case.call("POST", path, owner="beta")
    assert denied.status_code == 404
    assert case.port.calls == 1
    aggregate = json.loads(Path("web/src/generated/openapi.json").read_text())
    assert public_contract(case.app.openapi(), "integrations", case.catalog) == public_contract(
        aggregate, "integrations", case.catalog
    )
    assert (await case.client.get("/v1/integrations/mcp")).status_code == 401
    assert (await case.client.get("/v1/accounts")).status_code == 404


async def test_silent_validation_revocation_marks_unknown_and_retains_capacity(case):
    id = await create_mcp(case)
    case.port.wait = True
    pending = asyncio.create_task(case.call("POST", f"/v1/integrations/mcp/{id}/validate"))
    await asyncio.wait_for(case.port.entered.wait(), 2)
    case.port.active_value = False
    response = await asyncio.wait_for(pending, 4)
    assert response.status_code == 200, response.text
    assert response.json()["check"]["ok"] is False
    assert case.port.closed.is_set()
    assert [change[1] for change in case.port.changes] == ["acquire"]
    runner = case.app.state.supervisor.runners[0]
    await runner.recover()
    await runner.process_once()
    assert case.port.calls == 1
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        attempt = await session.scalar(select(ValidationAttempt))
        assert attempt.status == "unknown" and not attempt.released


async def test_owned_skills_upload_preview_download_and_delete(case):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "SKILL.md", "---\nname: owned-skill\ndescription: Independent\n---\n# Owned\n"
        )
        archive.writestr("notes/test.txt", "hello")
    response = await case.call(
        "POST",
        "/v1/integrations/skills",
        files={"file": ("skill.zip", buffer.getvalue(), "application/zip")},
        data={"enabled": "true"},
    )
    assert response.status_code == 201, response.text
    item = response.json()
    id = item["id"]
    markdown = await case.call("GET", f"/v1/integrations/skills/{id}/versions/v1/skill-md")
    assert markdown.status_code == 200, markdown.text
    assert "# Owned" in markdown.json()["content"]
    hidden = await case.call("GET", f"/v1/integrations/skills/{id}", owner="beta")
    assert hidden.status_code == 404
    deleted = await case.call(
        "DELETE", f"/v1/integrations/skills/{id}", params={"expected_revision": item["revision"]}
    )
    assert deleted.status_code == 200, deleted.text
    assert not case.settings.account_skill_path("alpha").joinpath(id).exists()


def test_integrations_source_does_not_load_foreign_state():
    source = """import sys
from studio.assembly.independent.integrations.application import create_app
for forbidden in (
    'app.runtime.db','app.orm','app.console','app.llm.models',
    'app.capabilities.asset_store.models','app.apps',
):
    loaded=any(name==forbidden or name.startswith(forbidden+'.') for name in sys.modules)
    assert not loaded,forbidden
"""
    result = subprocess.run(
        [sys.executable, "-c", source],
        env={**os.environ, "PYTHONPATH": "backend:."},
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def test_skill_files_follow_confirmed_database_state_after_lost_commit_reply(
    case, monkeypatch
):
    from app.integrations.models import SkillIntegration
    from app.integrations.skills.archive import SkillArchiveStorage
    from app.integrations.skills.catalog import SkillCatalog
    from studio.apps.integrations.skill_files import reconcile_skill_files

    class Archive:
        filename = "skill.zip"
        content_type = "application/zip"

        def __init__(self):
            stream = io.BytesIO()
            with zipfile.ZipFile(stream, "w") as archive:
                archive.writestr(
                    "SKILL.md", "---\nname: uncertain-skill\ndescription: retained\n---\nContent"
                )
            self.stream = io.BytesIO(stream.getvalue())

        async def read(self, size):
            return self.stream.read(size)

        async def close(self):
            self.stream.close()

    async def lost_reply(session):
        commit = session.commit

        async def lost():
            await commit()
            raise OSError("synthetic reply lost after commit")

        monkeypatch.setattr(session, "commit", lost)

    storage = SkillArchiveStorage(case.settings, "alpha")
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        await lost_reply(session)
        with pytest.raises(OSError, match="synthetic reply lost"):
            await SkillCatalog(session, "alpha", storage=storage).create(Archive(), enabled=True)
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.scalar(select(SkillIntegration))
        skill_id, revision = row.id, row.revision
    assert storage.final_path(skill_id, "v1").joinpath("SKILL.md").is_file()
    await reconcile_skill_files(case.app.state.database, case.settings)
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        await lost_reply(session)
        with pytest.raises(OSError, match="synthetic reply lost"):
            await SkillCatalog(session, "alpha", storage=storage).add_version(
                skill_id, Archive(), expected_revision=revision
            )
    assert storage.final_path(skill_id, "v2").joinpath("SKILL.md").is_file()
    await reconcile_skill_files(case.app.state.database, case.settings)
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(SkillIntegration, skill_id)
        assert row.latest_version == "v2"
        revision = row.revision
        await lost_reply(session)
        with pytest.raises(OSError, match="synthetic reply lost"):
            await SkillCatalog(session, "alpha", storage=storage).delete(skill_id, revision)
    assert storage.final_path(skill_id, "v1").is_dir()
    await reconcile_skill_files(case.app.state.database, case.settings)
    assert not storage.root.joinpath(skill_id).exists()


async def test_tool_validation_binds_actual_input_and_rejects_invalid_body(case):
    created = await case.call(
        "POST",
        "/v1/integrations/tool-apis",
        json={
            "name": "Input-bound demo",
            "method": "GET",
            "url": "https://fpl-tools.invalid/products",
            "parameters_schema": {"type": "object", "properties": {"q": {"type": "string"}}},
        },
    )
    assert created.status_code == 201, created.text
    path = f"/v1/integrations/tool-apis/{created.json()['id']}/validate"
    malformed = await case.call("POST", path, json=[])
    assert malformed.status_code == 422, malformed.text
    response = await case.call("POST", path, json={"input": {"q": "owned query"}})
    assert response.status_code == 200, response.text
    assert response.json()["check"]["ok"], response.text
    assert json.loads(response.json()["response_preview"])["seen"] == {"q": "owned query"}
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        rows = list(await session.scalars(select(ValidationAttempt)))
        assert len(rows) == 1 and rows[0].status == "completed" and rows[0].released


async def test_validation_recovery_routes_are_account_scoped_and_fail_closed(case):
    from studio.contracts.integrations.integration_intents import IntegrationScope

    identity = str(uuid4())
    scope = IntegrationScope(
        kind="tool.validate",
        task_id=uuid4(),
        connection_id="visible-id",
        connection_revision=1,
        input_sha256="a" * 64,
    )
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            ValidationAttempt(
                id=identity,
                owner_user_id="alpha",
                scope=scope.model_dump(mode="json"),
                status="unknown",
            )
        )
        await session.commit()
    path = "/v1/integrations/validation-attempts"
    listed = await case.call("GET", path)
    assert listed.status_code == 200, listed.text
    assert listed.json()["items"][0]["id"] == identity
    assert "input_sha256" not in listed.text and "authorization" not in listed.text
    assert (await case.call("GET", path, owner="beta")).json()["items"] == []
    review = path + "/" + identity + "/reconcile"
    assert (await case.call("POST", review, owner="beta")).status_code == 404
    pending = await case.call("POST", review, json={"confirmed": True})
    assert pending.status_code == 409
    assert pending.json()["code"] == "integration_validation_evidence_pending"
    assert not case.port.changes
