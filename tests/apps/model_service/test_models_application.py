"""Independent Models HTTP uses only its own schema and explicit external ports."""

import asyncio
import io
import json
import os
import subprocess
import sys
import time
import wave
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy import select

from studio.apps.model_service.account_directory import Target, Targets
from studio.apps.model_service.audit.audit_client import PreparedChange
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.call_log import LlmCallLog
from studio.apps.model_service.storage.models.model_service import ModelProvider
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.service_models import GovernanceAudit
from studio.apps.model_service.templates.policy import initialize_account_catalog
from studio.assembly.independent.model_service.application import create_app
from studio.config.settings import Settings, get_settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.model_service.model_audit import ModelAuditReceipt, PreparedModelAudit
from studio.runtime.database.migrations import apply
from studio.runtime.time import utc_now


class Port:
    def __init__(self):
        self.active_value = True
        self.targets_value = []

    async def close(self):
        pass

    async def pending(self):
        return []

    async def active(self, **_kwargs):
        return self.active_value

    async def status(self, **_kwargs):
        return self.active_value

    async def prepare(self, _request, event_type, detail):
        return PreparedChange(
            PreparedModelAudit(id=uuid4(), fingerprint="a" * 64), event_type, detail, utc_now()
        )

    async def prepare_child(self, body):
        return PreparedModelAudit(id=body.id, fingerprint=body.fingerprint())

    async def commit(self, body):
        return ModelAuditReceipt(id=body.id, fingerprint=body.fingerprint, audit_event_id=uuid4())

    async def targets(self, **_kwargs):
        return Targets(
            active=self.active_value, expires_at=int(time.time()) + 5, targets=self.targets_value
        )


@pytest.fixture
async def case(tmp_path, monkeypatch):
    monkeypatch.setenv("FPL_DATABASE_PATH", str(tmp_path / "service.db"))
    get_settings.cache_clear()
    settings = Settings(_config_file=None, fpl_database_path=str(tmp_path / "service.db"))
    apply(settings.database_path, "models", MIGRATIONS)
    key = Ed25519PrivateKey.generate()
    port = Port()
    app = create_app(
        settings=settings,
        catalog=RouteCatalog.read(Path("deploy/contracts/ownership.json")),
        public_key=key.public_key(),
        identity=port,
        capabilities=port,
        events=port,
        directory=port,
        audit=port,
        run_tasks=False,
    )
    async with app.router.lifespan_context(app):
        for owner in ("alpha", "beta"):
            async with app.state.database.sessions(info={"owner_user_id": owner}) as session:
                await initialize_account_catalog(session, owner, "admin")
                await session.commit()
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:

            def headers(method, path, *, owner="alpha", role="admin", kind="session"):
                actor = Actor(
                    user_id=owner,
                    purpose="management" if path.startswith("/v1/platform/") else "studio",
                    platform_role=role,
                    auth_kind=kind,
                    scopes=tuple(sorted(role_scopes(role))),
                    session_id="session-" + owner if kind == "session" else None,
                    api_key_id="key-" + owner if kind != "session" else None,
                )
                return {
                    "x-fpl-context": issue_context(
                        actor,
                        service="models",
                        method=method,
                        path=path,
                        private_key=key,
                        key_id="test",
                    )
                }

            async def call(method, path, *, owner="alpha", role="admin", kind="session", **options):
                return await client.request(
                    method,
                    path,
                    headers=headers(method, path, owner=owner, role=role, kind=kind),
                    **options,
                )

            yield SimpleNamespace(
                app=app, client=client, call=call, headers=headers, port=port, settings=settings
            )
    get_settings.cache_clear()


async def install_mock(case):
    path = "/v1/platform/demo-services/mock_model/actions"
    started = await case.call("POST", path, json={"expected_revision": 0, "action": "start"})
    assert started.status_code == 200, started.text
    assert started.json()["ready"] is True
    catalog = (await case.call("GET", "/v1/model-providers")).json()
    response = await case.call(
        "POST",
        "/v1/account/demo-services/mock_model/install",
        json={"expected_catalog_revision": catalog["revision"]},
    )
    assert response.status_code == 200, response.text
    catalog = (await case.call("GET", "/v1/model-providers")).json()
    return next(
        model["id"]
        for provider in catalog["providers"]
        for model in provider["models"]
        if model["slug"] == "fpl-mock"
    )


async def test_models_owned_demo_text_logs_and_account_isolation(case):
    model = await install_mock(case)
    response = await case.call(
        "POST",
        "/v1/model-inference/text",
        json={"model_id": model, "messages": [{"role": "user", "text": "owned model"}]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["text"] == "这是本地测试模型的确定性回复。"
    assert response.headers["cache-control"] == "no-store"
    denied = await case.call(
        "POST",
        "/v1/model-inference/text",
        owner="beta",
        json={"model_id": model, "messages": [{"role": "user", "text": "cross-account"}]},
    )
    assert denied.status_code == 404, denied.text
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        logs = list(await session.scalars(select(LlmCallLog)))
        assert len(logs) == 1 and logs[0].status == "success"
    assert (await case.client.get("/v1/model-providers")).status_code == 401
    assert (await case.client.get("/v1/accounts")).status_code == 404
    assert (await case.client.get("/health")).status_code == 200


async def test_governance_denies_keys_and_preserves_cas_and_audit(case):
    path = "/v1/platform/runtime-quotas"
    assert (await case.call("GET", path, role="user")).status_code == 403
    assert (await case.call("GET", path, kind="management_api_key")).status_code == 403
    current = (await case.call("GET", path)).json()
    body = {"expected_revision": current["revision"], "value": current["value"]}
    saved = await case.call("PATCH", path, json=body)
    assert saved.status_code == 200, saved.text
    conflict = await case.call("PATCH", path, json=body)
    assert conflict.status_code == 409, conflict.text
    async with case.app.state.database.sessions() as session:
        audit = list(await session.scalars(select(GovernanceAudit)))
        assert len(audit) == 1 and audit[0].actor_user_id == "alpha"


async def test_template_sync_rechecks_current_admin_and_target_and_preserves_other_catalogues(case):
    path = "/v1/platform/model-service-templates/user"
    template = {
        "providers": [
            {
                "template_key": "p",
                "name": "Owned template",
                "kind": "openai",
                "base_url": "https://provider.invalid/v1",
                "api_key": "synthetic-template-key",
                "models": [{"template_key": "m", "slug": "fixture", "label": "Fixture"}],
            }
        ],
        "defaults": {},
    }
    saved = await case.call("PUT", path, json={"expected_revision": 0, "value": template})
    assert saved.status_code == 200, saved.text
    assert "synthetic-template-key" not in saved.text
    case.port.targets_value = [Target(id="beta", display_name="Beta", revision=0)]
    preview = await case.call(
        "POST", path + "/preview", json={"expected_template_revision": 1, "account_ids": ["beta"]}
    )
    assert preview.status_code == 201, preview.text
    job = preview.json()
    started = await case.call(
        "POST",
        "/v1/platform/model-service-templates/sync-jobs/" + job["id"] + "/start",
        json={"expected_revision": job["revision"]},
    )
    assert started.status_code == 200, started.text
    await case.app.state.template_sync.process_once()
    result = (
        await case.call("GET", "/v1/platform/model-service-templates/sync-jobs/" + job["id"])
    ).json()
    assert result["items"][0]["status"] == "succeeded", result
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert not any(
            row.name == "Owned template" for row in await session.scalars(select(ModelProvider))
        )
    async with case.app.state.database.sessions(info={"owner_user_id": "beta"}) as session:
        assert any(
            row.name == "Owned template" for row in await session.scalars(select(ModelProvider))
        )


def test_models_import_does_not_load_account_assets_or_singleton_database():
    source = """
import sys
import studio.assembly.independent.model_service.application
for name in sys.modules:
    assert name not in {
        'studio.runtime.database.website','studio.assembly.website.models',
        'studio.apps.asset_library.storage.models','studio.apps.asset_library.storage.file_paths',
    }
    assert not name.startswith(('app.console.models', 'app.console.governance', 'app.apps.'))
"""
    environment = {**os.environ, "PYTHONPATH": "backend:."}
    result = subprocess.run(
        [sys.executable, "-c", source], env=environment, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr


def test_real_identity_governance_targets_and_socket_revocation(tmp_path):
    environment = {
        **os.environ,
        "PYTHONPATH": "backend:.",
        "MODEL_GOVERNANCE_ROOT": str(tmp_path),
        "FPL_DATABASE_PATH": str(tmp_path / "service.db"),
        "FPL_CONFIG_FILE": str(tmp_path / "absent.toml"),
    }
    result = subprocess.run(
        [sys.executable, "tests/model_governance_scenario.py"],
        env=environment,
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert result.returncode == 0, result.stdout + result.stderr


async def add_owned_model(case, kind, slug, capability):
    catalog = (await case.call("GET", "/v1/model-providers")).json()
    response = await case.call(
        "POST",
        "/v1/model-providers",
        json={
            "expected_catalog_revision": catalog["revision"],
            "name": "Synthetic " + kind,
            "kind": kind,
            "base_url": "https://provider.invalid/v1",
            "api_key": "synthetic-provider-key",
            "enabled": True,
        },
    )
    assert response.status_code == 200, response.text
    provider = response.json()
    response = await case.call(
        "POST",
        "/v1/model-providers/" + provider["provider"]["id"] + "/models",
        json={
            "expected_catalog_revision": provider["revision"],
            "slug": slug,
            "label": "Fixture",
            "capabilities": [capability],
            "categories": [],
            "enabled": True,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["model"]["id"]


@pytest.mark.parametrize("kind", ["inference", "model", "transcription"])
async def test_wired_runners_revoke_queued_submission_and_settle_same_owned_lease(
    case, monkeypatch, kind
):
    async def forbidden_call(**_kwargs):
        raise AssertionError("revoked queued job must not reach its supplier")

    if kind == "transcription":
        identity = await add_owned_model(case, "openai", "whisper-1", "speech_recognition")
        content = io.BytesIO()
        with wave.open(content, "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\0\0" * 800)
        response = await case.call(
            "POST",
            "/v1/model-test/transcription-tasks/upload",
            data={"model_id": identity},
            files={"upload": ("input.wav", content.getvalue(), "audio/wav")},
        )
        runner = next(
            r
            for r in case.app.state.runner_supervisor.runners
            if r.runner_name == "model-test-transcription-runner"
        )
        monkeypatch.setattr(
            "studio.apps.model_service.playground.transcription_runner.transcribe_model_audio",
            forbidden_call,
        )
        method = runner._process_task
        endpoint = "/v1/model-test/transcription-tasks/"
    else:
        identity = await add_owned_model(
            case, "senseaudio_image", "senseaudio-image-2.0-260319", "image_generation"
        )
        if kind == "inference":
            response = await case.call(
                "POST",
                "/v1/model-inference/tasks",
                json={
                    "request_id": "accepted-job",
                    "model_id": identity,
                    "kind": "image",
                    "parameters": {"prompt": "fixture", "size": "1024x1024"},
                },
            )
            runner = next(
                r
                for r in case.app.state.runner_supervisor.runners
                if r.runner_name == "model-inference"
            )
            monkeypatch.setattr(
                "studio.apps.model_service.inference.runner.submit_generation_task", forbidden_call
            )
            method = runner.process
            endpoint = "/v1/model-inference/tasks/"
        else:
            response = await case.call(
                "POST",
                "/v1/model-test/generation-tasks",
                json={
                    "kind": "image",
                    "model_id": identity,
                    "prompt": "fixture",
                    "size": "1024x1024",
                },
            )
            runner = next(
                r
                for r in case.app.state.runner_supervisor.runners
                if r.runner_name == "model-test-generation-runner"
            )
            monkeypatch.setattr(
                "studio.apps.model_service.playground.generation_runner.submit_generation_task",
                forbidden_call,
            )
            method = runner._process_task
            endpoint = "/v1/model-test/generation-tasks/"
    assert response.status_code == 200, response.text
    task = response.json()
    case.port.active_value = False
    await method(task["id"])
    result = await case.call("GET", endpoint + task["id"])
    assert result.status_code == 200, result.text
    assert result.json()["status"] == "failed", result.text
    assert "未提交供应商" in result.json()["error_message"]
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        leases = list(await session.scalars(select(RuntimeAdmission)))
        assert len(leases) == 1 and leases[0].released_at is not None
        assert len(list(await session.scalars(select(LlmCallLog)))) == 1


@pytest.mark.parametrize("playground", [False, True])
async def test_silent_model_stream_stops_on_revocation_and_settles_owned_state(
    case, monkeypatch, playground
):
    from studio.apps.model_service.providers.streaming import TextDelta

    model = await install_mock(case)
    entered = asyncio.Event()
    closed = asyncio.Event()

    async def silent(**_kwargs):
        try:
            entered.set()
            yield TextDelta(text="partial")
            await asyncio.Future()
        finally:
            closed.set()

    if playground:
        monkeypatch.setattr(
            "studio.apps.model_service.playground.stream.stream_text_completion", silent
        )
        created = await case.call("POST", "/v1/model-test/conversations", json={"model_id": model})
        assert created.status_code == 200, created.text
        path = "/v1/model-test/conversations/" + created.json()["id"] + "/messages/stream"
        body = {"expected_revision": created.json()["revision"], "content": "fixture"}
    else:
        monkeypatch.setattr(
            "studio.apps.model_service.inference.text.stream_text_completion", silent
        )
        path = "/v1/model-inference/text/stream"
        body = {"model_id": model, "messages": [{"role": "user", "text": "fixture"}]}
    pending = asyncio.create_task(case.call("POST", path, json=body))
    await asyncio.wait_for(entered.wait(), 2)
    case.port.active_value = False
    response = await asyncio.wait_for(pending, 4)
    assert response.status_code == 200, response.text
    assert '"error"' in response.text and closed.is_set()
    async with case.app.state.database.sessions(info={"owner_user_id": "alpha"}) as session:
        logs = list(await session.scalars(select(LlmCallLog)))
        assert len(logs) == 1 and logs[0].status == "error"
        leases = list(await session.scalars(select(RuntimeAdmission)))
        assert len(leases) == 1 and leases[0].released_at is not None


async def test_models_all_owned_runners_start_and_stop_with_independent_schema(case):
    supervisor = case.app.state.runner_supervisor
    await supervisor.start()
    try:
        await asyncio.sleep(0.05)
        assert supervisor.is_healthy, supervisor.health
        assert len(supervisor.runners) == 8
        assert any(
            runner.runner_name == "visual-assistant-model-expiry" for runner in supervisor.runners
        )
    finally:
        await supervisor.stop()
    assert all(not status.running for status in supervisor.health)


async def test_independent_models_contract_matches_page_build_input(case):
    from studio.contracts.gateway.protocol_hash import public_contract

    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    aggregate = json.loads(Path("web/src/generated/openapi.json").read_text())
    assert public_contract(case.app.openapi(), "models", catalog) == public_contract(
        aggregate, "models", catalog
    )


async def test_audit_prepare_failure_does_not_mutate_policy_or_publish_an_outcome(
    case, monkeypatch
):
    from studio.runtime.database.operation_receipts import OperationError

    async def unavailable(*_args, **_kwargs):
        raise OperationError("synthetic audit unavailable", "model_audit_unavailable", 503)

    monkeypatch.setattr(case.port, "prepare", unavailable)
    path = "/v1/platform/runtime-quotas"
    before = (await case.call("GET", path)).json()
    response = await case.call(
        "PATCH", path, json={"expected_revision": before["revision"], "value": before["value"]}
    )
    assert response.status_code == 503, response.text
    assert (await case.call("GET", path)).json() == before
    async with case.app.state.database.sessions() as session:
        assert not list(await session.scalars(select(GovernanceAudit)))
