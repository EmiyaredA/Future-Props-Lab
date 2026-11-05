"""Accepted input, current Identity authorization and local claim remain separate boundaries."""

import asyncio
import os
import subprocess
import sys
from dataclasses import replace
from pathlib import Path
from types import SimpleNamespace

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import FastAPI, Request
from sqlalchemy import select, text
from tests.credential_test_support import encrypt_secret

from studio.apps.model_service.admission import execution_authority as authority_module
from studio.apps.model_service.admission.admission import ModelAdmission, settle
from studio.apps.model_service.admission.execution_authority import ModelTaskAuthority
from studio.apps.model_service.admission.request_admission import request_admission
from studio.apps.model_service.generation.driver import GenerationTaskStore
from studio.apps.model_service.generation.outcomes import (
    SUBMISSION_INTERRUPTED_MESSAGE,
    TaskClaimRejected,
)
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.models.model_inference import ModelInferenceTask
from studio.apps.model_service.storage.models.model_service import ModelProvider
from studio.apps.model_service.storage.models.runtime_admission import RuntimeAdmission
from studio.apps.model_service.storage.service_models import (
    ACCOUNT_MODELS,
    MODELS,
    TaskAuthorization,
)
from studio.apps.model_service.transport.website.model_capacity import ModelCapacity, task_admission
from studio.assembly.http_dependencies import OwnerDep, SessionDep
from studio.config.settings import get_settings as isolated_settings
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import Actor, issue_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.http.authentication import SignedIdentity
from studio.runtime.secrets import SecretCipher

SOURCE_PATH = "/v1/model-inference/tasks"


class Identity:
    def __init__(self, database):
        self.database, self.result, self.calls = database, True, []

    async def status(self, **source):
        # The authority must have closed its read session before contacting Identity.
        # An unrelated writer can acquire SQLite's writer lock during this await.
        async with self.database.sessions(info={"owner_user_id": "beta"}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            await session.rollback()
        self.calls.append(source)
        return self.result


@pytest.fixture
async def case(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    key = Ed25519PrivateKey.generate()
    catalog = RouteCatalog.read(Path("deploy/contracts/ownership.json"))
    identity = Identity(database)
    authority = ModelTaskAuthority(
        database.sessions, public_key=key.public_key(), catalog=catalog, identity=identity
    )
    actor = Actor(
        user_id="alpha",
        platform_role="user",
        auth_kind="session",
        session_id="accepted-session",
        scopes=tuple(sorted(role_scopes("user"))),
    )
    token = issue_context(
        actor, service="models", method="POST", path=SOURCE_PATH, private_key=key, key_id="test"
    )
    try:
        async with database.sessions(info={"owner_user_id": "alpha"}) as session:
            session.add(
                ModelProvider(
                    id="provider-alpha",
                    owner_user_id="alpha",
                    name="Synthetic provider",
                    kind="openai",
                    base_url="https://provider.invalid/v1",
                    api_key_ciphertext=encrypt_secret("synthetic-provider-key"),
                )
            )
            await session.commit()
        yield SimpleNamespace(
            database=database,
            key=key,
            catalog=catalog,
            identity=identity,
            authority=authority,
            actor=actor,
            token=token,
            ledger=ModelAdmission(database.sessions),
        )
    finally:
        await database.close()


def task(identity="job", *, status="queued"):
    return ModelInferenceTask(
        id=identity,
        owner_user_id="alpha",
        request_id=identity,
        fingerprint="f" * 64,
        provider_id="provider-alpha",
        provider_kind="openai",
        provider_name="Synthetic provider",
        model_slug="fixture",
        kind="image",
        request_payload={"prompt": "Synthetic"},
        status=status,
    )


def source(case, **changes):
    return {
        "assertion": case.token,
        "actor": case.actor,
        "method": "POST",
        "path": SOURCE_PATH,
        "kind": "inference",
        "task_ids": ["job"],
        **changes,
    }


async def accepted(case, *, rollback=False):
    principal = StudioPrincipal(
        user_id="alpha",
        must_change_password=False,
        auth_kind="session",
        platform_role="user",
        session_id="accepted-session",
        scopes=frozenset(role_scopes("user")),
    )
    lease = await case.ledger.acquire(principal)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        await case.ledger.attach(session, lease, "inference", ["job"])
        await case.authority.retain(session, **source(case))
        if rollback:
            await session.rollback()
        else:
            await session.commit()
    return lease


def store(case):
    async def prepare(identity):
        return await case.authority.prepare("inference", identity)

    return GenerationTaskStore(
        session_factory=case.database.sessions,
        task_type=ModelInferenceTask,
        active_statuses=("queued", "submitting", "pending", "processing"),
        task_subject="job",
        prepare_claim=prepare,
        terminal_settlement=settle,
        decrypt=SecretCipher(isolated_settings().fpl_secrets_key).decrypt,
    )


async def test_authority_and_task_share_commit_and_replay_cannot_change_inputs(case):
    await accepted(case)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        await case.authority.retain(session, **source(case))
        rows = list(await session.scalars(select(TaskAuthorization)))
        assert len(rows) == 1 and rows[0].assertion == case.token
        (await session.get(ModelInferenceTask, "job")).request_payload = {"prompt": "Changed"}
        with pytest.raises(ValueError, match="不能更换"):
            await case.authority.retain(session, **source(case))
        await session.rollback()
    async with case.database.sessions(info={"owner_user_id": "beta"}) as session:
        assert not list(await session.scalars(select(TaskAuthorization)))


async def test_rollback_leaves_neither_task_nor_authority(case):
    lease = await accepted(case, rollback=True)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await session.get(ModelInferenceTask, "job") is None
        assert not list(await session.scalars(select(TaskAuthorization)))
        assert (await session.get(RuntimeAdmission, lease)).task_kind is None


@pytest.mark.parametrize("fault", ["token", "actor", "path", "owner", "kind"])
async def test_forged_source_or_foreign_task_cannot_retain_authority(case, fault):
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        changes = {}
        if fault == "token":
            changes["assertion"] = case.token[:-8] + "tampered"
        elif fault == "actor":
            changes["actor"] = replace(case.actor, session_id="another-session")
        elif fault == "path":
            changes["path"] = "/v1/model-inference/text"
        elif fault == "owner":
            session.info["owner_user_id"] = "beta"
            await session.rollback()
        else:
            changes["kind"] = "visual"
        with pytest.raises((ValueError, jwt.InvalidTokenError)):
            await case.authority.retain(session, **source(case, **changes))


async def test_live_check_precedes_writer_and_concurrent_claim_submits_once(case):
    await accepted(case)
    first, second = await asyncio.gather(store(case).claim("job"), store(case).claim("job"))
    assert sum(value is not None and value.status == "queued" for value in (first, second)) == 1
    assert case.identity.calls
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelInferenceTask, "job")).status == "submitting"


async def test_identity_unavailable_defers_without_failing_or_releasing_capacity(case):
    lease = await accepted(case)
    case.identity.result = None
    assert await store(case).claim("job") is None
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelInferenceTask, "job")).status == "queued"
        assert (await session.get(RuntimeAdmission, lease)).released_at is None


async def test_revoked_authorization_fails_queued_job_and_settles_atomically(case):
    lease = await accepted(case)
    case.identity.result = False
    assert await store(case).claim("job") is None
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceTask, "job")
        assert row.status == "failed" and "授权已失效" in row.error_message
        assert (await session.get(RuntimeAdmission, lease)).released_at is not None
    assert await store(case).claim("job") is None


async def test_failed_settlement_rolls_back_rejection_with_the_original_reservation(case):
    lease = await accepted(case)
    case.identity.result = False
    guarded = store(case)

    async def unavailable(_session):
        raise RuntimeError("synthetic local settlement failure")

    guarded.terminal_settlement = unavailable
    with pytest.raises(RuntimeError, match="settlement failure"):
        await guarded.claim("job")
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelInferenceTask, "job")).status == "queued"
        assert (await session.get(RuntimeAdmission, lease)).released_at is None
    assert await store(case).claim("job") is None


async def test_expired_local_decision_defers_and_input_change_is_rejected(case, monkeypatch):
    await accepted(case)
    clock = [0.0]
    monkeypatch.setattr(authority_module, "monotonic", lambda: clock[0])
    prepared = await case.authority.prepare("inference", "job")
    clock[0] = 6
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceTask, "job")
        assert await prepared(session, row) is False
        row.request_payload = {"prompt": "Changed after authorization"}
        with pytest.raises(TaskClaimRejected):
            await prepared(session, row)


async def test_missing_or_changed_authority_is_not_a_submission_grant(case):
    lease = await accepted(case)
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(TaskAuthorization, ("inference", "job"))
        row.fingerprint = "0" * 64
        await session.commit()
    assert await store(case).claim("job") is None
    assert not case.identity.calls
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(ModelInferenceTask, "job")).status == "failed"
        assert (await session.get(RuntimeAdmission, lease)).released_at is not None


async def test_settlement_and_unknown_submission_do_not_resubmit_after_revocation(case):
    lease = await accepted(case)
    claimed = await store(case).claim("job")
    assert claimed.status == "queued"
    await store(case).mark_submitted("job", "original-supplier-id")
    case.identity.calls.clear()
    case.identity.result = False
    pending = await store(case).claim("job")
    assert pending.status == "pending" and pending.provider_task_id == "original-supplier-id"
    assert not case.identity.calls
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        (await session.get(ModelInferenceTask, "job")).status = "submitting"
        await session.commit()
    await store(case).recover_submitting()
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.get(ModelInferenceTask, "job")
        assert row.status == "failed" and row.error_message == SUBMISSION_INTERRUPTED_MESSAGE
        assert (await session.get(RuntimeAdmission, lease)).released_at is None


async def test_signed_http_binding_retains_original_request_without_shared_state(case):
    async def no_spawn(*_args):
        raise AssertionError("No cross-service spawned-task permission was granted")

    app = FastAPI()
    app.state.database = case.database
    app.state.model_admission = request_admission(case.ledger, case.authority, admit_tasks=no_spawn)
    app.add_middleware(
        SignedIdentity, service="models", public_key=case.key.public_key(), catalog=case.catalog
    )

    @app.post(SOURCE_PATH, dependencies=[ModelCapacity])
    async def create(request: Request, session: SessionDep, owner: OwnerDep):
        assert owner == "alpha"
        session.add(task())
        await task_admission(request, session, "inference")(["job"])
        await session.commit()
        return {"id": "job"}

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://models"
    ) as client:
        response = await client.post(SOURCE_PATH, headers={"X-Fpl-Context": case.token}, json={})
        assert response.status_code == 200, response.text
    async with case.database.sessions(info={"owner_user_id": "alpha"}) as session:
        record = await session.get(TaskAuthorization, ("inference", "job"))
        assert record.assertion == case.token and record.source_path == SOURCE_PATH
        leases = list(await session.scalars(select(RuntimeAdmission)))
        assert len(leases) == 1 and leases[0].released_at is None


def test_authority_source_closure_does_not_load_accounts_assets_or_legacy_database():
    root = Path(__file__).resolve().parents[1]
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
import studio.apps.model_service.admission.execution_authority
import studio.apps.model_service.admission.request_admission
assert 'studio.runtime.database.website' not in sys.modules
assert 'studio.assembly.website.models' not in sys.modules
assert not any(n.startswith(('app.console.models', 'app.apps.',
    'studio.apps.asset_library.storage.models')) for n in sys.modules)
""",
        ],
        cwd=root,
        env={**os.environ, "PYTHONPATH": str(root / "backend")},
        capture_output=True,
        text=True,
        timeout=15,
    )
    assert result.returncode == 0, result.stdout + result.stderr
