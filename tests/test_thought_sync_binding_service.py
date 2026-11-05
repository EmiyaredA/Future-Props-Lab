"""Thought binds a document through the real Identity and Integrations HTTP contracts."""

from uuid import uuid4

import httpx
import pytest
from cryptography.fernet import Fernet
from tests.test_community_asset_protocol import (
    CATALOG,
    GATEWAY_SECRET,
    PASSWORD,
    PEER_SECRET,
    THOUGHT_SECRET,
    Noop,
    scenario,  # noqa: F401
)

from app.runtime.config import Settings
from fpl_integrations.application import create_app as create_integrations
from fpl_integrations.migrations.registry import MIGRATIONS
from fpl_runtime.claims import HEADER
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.integration_client import IntegrationIntentClient
from fpl_runtime.migrations import apply
from fpl_runtime.retention_client import RetentionClient
from fpl_thought.application import create_app as create_thought
from test_external_article_sync import FakeFeishu


@pytest.mark.parametrize("failure", [None, "lost_receipt", "unknown_remote"])
async def test_independent_sync_is_account_scoped_and_recovers_only_confirmed_steps(
    scenario,  # noqa: F811
    tmp_path,
    failure,
):
    case = scenario
    remote = FakeFeishu()
    origin = "http://127.0.0.1:19000"
    credential = "integration-identity-secret-" * 3
    case.identity.state.identity_options["service_credentials"]["integrations"] = credential
    path = tmp_path / "integrations" / "service.db"
    apply(path, "integrations", MIGRATIONS)
    integrations = create_integrations(
        settings=Settings(
            _config_file=None,
            fpl_database_path=str(path),
            fpl_secrets_key=Fernet.generate_key().decode(),
        ),
        catalog=CATALOG,
        public_key=case.key.public_key(),
        identity=LiveAuthorization(
            service="integrations", credential=credential, transport=case.mesh
        ),
        intents=IntegrationIntentClient(
            service="integrations", credential=credential, transport=case.mesh
        ),
        capacity=Noop(),
        feishu_transport=remote.transport,
        run_tasks=False,
    )
    case.mesh.apps["integrations"] = integrations
    thought = create_thought(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=RetentionClient(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )

    async def authorize(browser, service, method, path):
        result = await browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": service,
                "X-Fpl-Request-Method": method,
                "X-Fpl-Request-Uri": path,
                "Origin": origin,
                "X-CSRF-Token": browser.cookies["fpl_csrf"],
            },
        )
        assert result.status_code == 204, result.text
        return {HEADER: result.headers[HEADER]}

    async with (
        integrations.router.lifespan_context(integrations),
        thought.router.lifespan_context(thought),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.identity),
            base_url=origin,
            headers={
                "X-Fpl-Gateway": GATEWAY_SECRET,
                "X-Fpl-Ingress": "local",
                "X-Fpl-Client-Ip": "127.0.0.1",
            },
        ) as owner,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=integrations), base_url="http://integrations"
        ) as integration_api,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=thought), base_url="http://thought"
        ) as thought_api,
    ):
        login = await owner.post(
            "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
        )
        assert login.status_code == 200
        connections = "/v1/integrations/external-connections"
        connection = await integration_api.post(
            connections,
            headers=await authorize(owner, "integrations", "POST", connections),
            json={"name": "Feishu", "app_id": "synthetic-app", "app_secret": "synthetic-secret"},
        )
        assert connection.status_code == 201, connection.text
        sync = "/v1/thought-workshop/notes/note/external-sync"
        path = sync + "/binding"
        body = {"connection_id": connection.json()["id"], "url": remote.url, "expected_revision": 0}
        denied = await thought_api.put(
            path, headers=await authorize(case.browser, "thought", "PUT", path), json=body
        )
        assert denied.status_code == 404, denied.text
        assert remote.token_requests == 0
        authorized = await authorize(owner, "thought", "PUT", path)
        remote.writable = False
        readonly = await thought_api.put(path, headers=authorized, json=body)
        assert readonly.status_code == 403 and "target_readonly" in readonly.text, readonly.text
        remote.writable = True
        bound = await thought_api.put(path, headers=authorized, json=body)
        assert bound.status_code == 200, bound.text
        assert bound.json()["url"] == remote.url
        changed = await thought_api.put(path, headers=authorized, json=body)
        assert changed.status_code == 200, changed.text
        assert changed.json()["revision"] == bound.json()["revision"] + 1
        stale = await thought_api.put(path, headers=authorized, json=body)
        assert stale.status_code == 409, stale.text
        state = await thought_api.get(sync, headers=await authorize(owner, "thought", "GET", sync))
        assert state.json()["binding"] == changed.json()
        path = sync + "/preview"
        payload = {"expected_revision": 0, "binding_revision": changed.json()["revision"]}
        denied = await thought_api.post(
            path, headers=await authorize(case.browser, "thought", "POST", path), json=payload
        )
        assert denied.status_code == 404, denied.text
        stale = await thought_api.post(
            path,
            headers=await authorize(owner, "thought", "POST", path),
            json={**payload, "binding_revision": 0},
        )
        assert stale.status_code == 409, stale.text
        preview = await thought_api.post(
            path, headers=await authorize(owner, "thought", "POST", path), json=payload
        )
        assert preview.status_code == 200, preview.text
        assert preview.json()["preview_id"] and preview.json()["remote_text"] == "远端原正文"
        assert preview.json()["first_sync"] is True
        assert remote.writes == []
        path = sync + "/tasks"
        confirmation = {
            "preview_id": preview.json()["preview_id"],
            "operation_id": str(uuid4()),
            "confirm_replace": True,
        }
        accepted = await thought_api.post(
            path, headers=await authorize(owner, "thought", "POST", path), json=confirmation
        )
        assert accepted.status_code == 202, accepted.text
        assert accepted.json()["status"] == "queued"
        replay = await thought_api.post(
            path, headers=await authorize(owner, "thought", "POST", path), json=confirmation
        )
        assert replay.json() == accepted.json()
        detail_path = path + "/" + accepted.json()["id"]
        reconcile_path = detail_path + "/reconcile"
        runner = thought.state.thought_sync_runner

        async def detail():
            return await thought_api.get(
                detail_path, headers=await authorize(owner, "thought", "GET", detail_path)
            )

        if failure == "lost_receipt":
            execute = integrations.state.external_steps.execute

            async def lose_first_confirmed_receipt(*args, **kwargs):
                result = await execute(*args, **kwargs)
                if remote.writes == ["append"]:
                    raise httpx.ReadError("synthetic response loss after commit")
                return result

            integrations.state.external_steps.execute = lose_first_confirmed_receipt
        elif failure == "unknown_remote":
            remote.timeout_after_append = True

        await runner.process_once()
        if failure:
            interrupted = await detail()
            assert interrupted.json()["status"] == "needs_review", interrupted.text
            assert remote.writes == ["append"]
            await runner.recover()
            denied = await thought_api.post(
                reconcile_path,
                headers=await authorize(case.browser, "thought", "POST", reconcile_path),
                json={"acknowledge_partial": True},
            )
            assert denied.status_code == 404, denied.text
            reviewed = await thought_api.post(
                reconcile_path,
                headers=await authorize(owner, "thought", "POST", reconcile_path),
                json={},
            )
            assert reviewed.status_code == 200, reviewed.text
            assert reviewed.json()["can_resume"] is (failure == "lost_receipt")
            if failure == "unknown_remote":
                closed = await thought_api.post(
                    reconcile_path,
                    headers=await authorize(owner, "thought", "POST", reconcile_path),
                    json={"acknowledge_partial": True},
                )
                assert closed.status_code == 200, closed.text
                assert closed.json()["task"]["status"] == "failed"
                await runner.process_once()
                assert remote.writes == ["append"]
                assert list(thought.state.thought_sync_artifacts.root.iterdir()) == []
                return
            await runner.process_once()
        finished = await detail()
        assert finished.status_code == 200, finished.text
        assert finished.json()["status"] == "succeeded", finished.text
        assert [step["status"] for step in finished.json()["steps"]] == ["confirmed"] * 4
        assert remote.writes == ["append", "upload", "image", "delete"]
        assert list(thought.state.thought_sync_artifacts.root.iterdir()) == []
