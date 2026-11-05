"""Execution capacity uses only the owned Models schema and survives uncertain outcomes."""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import select

from app.llm.models import ModelInferenceTask
from app.llm.models.runtime_admission import RuntimeAdmission as Admission
from app.llm.schemas.runtime_quotas import RuntimeQuotasIn
from app.llm.task_outcomes import SUBMISSION_INTERRUPTED_MESSAGE
from studio.apps.model_service.admission.admission import ModelAdmission, settle, usage
from studio.apps.model_service.admission.quotas import QuotaPolicies
from studio.apps.model_service.storage.migrations.registry import MIGRATIONS
from studio.apps.model_service.storage.service_models import ACCOUNT_MODELS, MODELS
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database


def actor(owner="alpha", role="user", *, scopes=("studio:write",), must_change=False):
    return StudioPrincipal(
        user_id=owner,
        platform_role=role,
        must_change_password=must_change,
        auth_kind="session",
        session_id="synthetic-session",
        scopes=frozenset(scopes),
    )


def task(identity="task-alpha", *, owner="alpha", status="queued", error=None):
    return ModelInferenceTask(
        id=identity,
        owner_user_id=owner,
        request_id=identity,
        fingerprint="f" * 64,
        provider_id=None,
        model_id=None,
        provider_kind="fixture",
        provider_name="Fixture",
        model_slug="fixture",
        kind="image",
        status=status,
        error_message=error,
    )


def policy(revision=0, *, total=4, per_user=2, voice=2, reserved=1):
    return RuntimeQuotasIn(
        expected_revision=revision,
        value={
            "instance": {"total": total, "realtime_voice": voice},
            "user": {"total": per_user, "realtime_voice": min(voice, per_user)},
            "admin": {"total": total, "realtime_voice": voice},
            "reserved_for_admins": reserved,
        },
    )


@pytest.fixture
async def database(tmp_path):
    apply(tmp_path / "service.db", "models", MIGRATIONS)
    database = Database("models", tmp_path, models=MODELS, account_models=ACCOUNT_MODELS)
    try:
        async with database.sessions() as session:
            await QuotaPolicies(session).save(policy())
            await session.commit()
        yield database
    finally:
        await database.close()


async def test_policy_cas_roundtrip_and_transaction_rollback(database):
    async with database.sessions() as session:
        assert (await QuotaPolicies(session).read())["revision"] == 1
        await QuotaPolicies(session).save(policy(1, per_user=1))
        await session.rollback()
    async with database.sessions() as session:
        assert (await QuotaPolicies(session).read())["value"].user.total == 2
        with pytest.raises(AccountError, match="revision_conflict") as conflict:
            await QuotaPolicies(session).save(policy(0))
        assert json.loads(json.dumps(conflict.value.current))["revision"] == 1


async def test_policy_concurrent_cas_has_one_winner(database):
    async def save():
        async with database.sessions() as session:
            result = await QuotaPolicies(session).save(policy(1, per_user=1))
            await session.commit()
            return result

    results = await asyncio.gather(save(), save(), return_exceptions=True)
    assert sum(isinstance(result, dict) for result in results) == 1
    errors = [result for result in results if isinstance(result, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], AccountError)
    assert errors[0].code == "revision_conflict"


async def test_concurrent_reservations_enforce_global_and_admin_reserved_slots(database):
    ledger = ModelAdmission(database.sessions)
    attempts = await asyncio.gather(
        *(ledger.acquire(actor(owner)) for owner in ("alpha", "beta", "gamma", "delta")),
        return_exceptions=True,
    )
    assert len([item for item in attempts if isinstance(item, str)]) == 3
    errors = [item for item in attempts if isinstance(item, Exception)]
    assert len(errors) == 1 and isinstance(errors[0], AccountError)
    assert errors[0].code == "runtime_quota_exceeded"
    admin_lease = await ledger.acquire(actor("admin", "admin"))
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor("second-admin", "admin"))
    await ledger.release(admin_lease)
    assert await ledger.acquire(actor("second-admin", "admin"))


async def test_per_account_voice_limits_and_release_are_independent(database):
    ledger = ModelAdmission(database.sessions)
    first = await ledger.acquire(actor(), voice=True)
    await ledger.acquire(actor(), voice=True)
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor())
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor("beta"), voice=True)
    await ledger.release(first)
    assert await ledger.acquire(actor("beta"), voice=True)


@pytest.mark.parametrize("failure", [asyncio.CancelledError, RuntimeError])
async def test_failed_reservation_response_releases_unreturned_lease(database, failure):
    sessions = database.sessions
    interrupt = [True]

    def interrupted_sessions(*args, **kwargs):
        session = sessions(*args, **kwargs)
        commit = session.commit

        async def interrupted_commit():
            await commit()
            if interrupt[0]:
                interrupt[0] = False
                raise failure("synthetic interruption after commit")

        session.commit = interrupted_commit
        return session

    with pytest.raises(failure):
        await ModelAdmission(interrupted_sessions).acquire(actor())
    async with sessions(info={"owner_user_id": "alpha"}) as session:
        leases = list(await session.scalars(select(Admission)))
        assert len(leases) == 1 and leases[0].released_at is not None


@pytest.mark.parametrize("principal", [actor(scopes=()), actor(must_change=True)])
async def test_unusable_principal_cannot_reserve(database, principal):
    with pytest.raises(AccountError, match="account_access_forbidden"):
        await ModelAdmission(database.sessions).acquire(principal)


@pytest.mark.parametrize("weight", [0, -1, True, 1.5, 1025])
async def test_invalid_weight_cannot_bypass_capacity(database, weight):
    with pytest.raises(ValueError):
        await ModelAdmission(database.sessions).acquire(actor(), weight=weight)


async def test_attach_is_atomic_idempotent_and_owner_scoped(database):
    ledger = ModelAdmission(database.sessions)
    lease_id = await ledger.acquire(actor())
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        session.add(task("task-beta", owner="beta"))
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        await ledger.attach(session, lease_id, "inference", ["task-alpha", "task-alpha"])
        await ledger.attach(session, lease_id, "inference", ["task-alpha"])
        with pytest.raises(AccountError, match="admission_not_found"):
            await ledger.attach(session, lease_id, "inference", ["task-beta"])
        await session.commit()
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        with pytest.raises(AccountError, match="admission_not_found"):
            await ledger.attach(session, lease_id, "inference", ["task-beta"])
    await ledger.release(lease_id)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        lease = await session.get(Admission, lease_id)
        assert lease.task_ids == ["task-alpha"] and lease.released_at is None
        assert await usage(session, "alpha") == (2, 1, 0, 0)


async def test_attach_rollback_retains_original_reservation_and_no_task(database):
    ledger = ModelAdmission(database.sessions)
    lease_id = await ledger.acquire(actor())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        await ledger.attach(session, lease_id, "inference", ["task-alpha"])
        await session.rollback()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await session.get(ModelInferenceTask, "task-alpha") is None
        assert (await session.get(Admission, lease_id)).task_kind is None
    await ledger.release(lease_id)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(Admission, lease_id)).released_at is not None


async def test_batch_growth_counts_new_tasks_once_and_rejects_foreign_tasks(database):
    ledger = ModelAdmission(database.sessions)
    lease_id = await ledger.acquire(actor())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add_all([task("task-1"), task("task-2")])
        await ledger.attach(session, lease_id, "inference", ["task-1", "task-2"])
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await usage(session, "alpha") == (2, 2, 0, 0)
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor())
    beta_lease = await ledger.acquire(actor("beta"))
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        with pytest.raises(AccountError, match="task_not_found"):
            await ledger.attach(session, beta_lease, "inference", ["task-1"])
        with pytest.raises(ValueError):
            await ledger.attach(session, beta_lease, "visual", ["task-1"])


async def test_a_task_cannot_be_attached_to_two_leases(database):
    ledger = ModelAdmission(database.sessions)
    first = await ledger.acquire(actor())
    second = await ledger.acquire(actor())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        await ledger.attach(session, first, "inference", ["task-alpha"])
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        with pytest.raises(AccountError, match="admission_not_found"):
            await ledger.attach(session, second, "inference", ["task-alpha"])


async def test_orphaned_tasks_count_global_and_own_capacity_without_private_rows(database):
    async with database.sessions(info={"owner_user_id": "beta"}) as session:
        session.add_all([task("orphan-1", owner="beta"), task("orphan-2", owner="beta")])
        await session.commit()
    ledger = ModelAdmission(database.sessions)
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor("beta"))
    assert await ledger.acquire(actor())
    with pytest.raises(AccountError, match="runtime_quota_exceeded"):
        await ledger.acquire(actor("gamma"))
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert await usage(session, "alpha") == (3, 1, 0, 0)
        assert not list(await session.scalars(select(ModelInferenceTask)))


async def test_recovery_retains_missing_unknown_and_interrupted_outcomes(database):
    ledger = ModelAdmission(database.sessions)
    ephemeral = await ledger.acquire(actor())
    attached = await ledger.acquire(actor())
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(task())
        await ledger.attach(session, attached, "inference", ["task-alpha"])
        row = await session.get(ModelInferenceTask, "task-alpha")
        row.status, row.error_message = "failed", SUBMISSION_INTERRUPTED_MESSAGE
        await session.commit()
    await ledger.recover()
    await ledger.recover()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(Admission, ephemeral)).released_at is not None
        assert (await session.get(Admission, attached)).released_at is None
        row = await session.get(ModelInferenceTask, "task-alpha")
        row.status = "unknown"
        row.error_message = None
        await settle(session)
        assert (await session.get(Admission, attached)).released_at is None
        await session.delete(row)
        await settle(session)
        assert (await session.get(Admission, attached)).released_at is None
        await session.commit()


async def test_completed_partial_batch_releases_only_confirmed_weight(database):
    ledger = ModelAdmission(database.sessions)
    lease = await ledger.acquire(actor(), weight=2)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add_all([task("one"), task("two")])
        await ledger.attach(session, lease, "inference", ["one", "two"])
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        (await session.get(ModelInferenceTask, "one")).status = "completed"
        await settle(session)
        assert (await session.get(Admission, lease)).weight == 1
        await session.commit()
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        (await session.get(ModelInferenceTask, "two")).status = "failed"
        await session.commit()
    await ledger.release(lease)
    async with database.sessions(info={"owner_user_id": "alpha"}) as session:
        assert (await session.get(Admission, lease)).released_at is not None
        assert await usage(session, "alpha") == (0, 0, 0, 0)


def test_fresh_admission_import_does_not_load_legacy_database_or_foreign_orm():
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            """
import sys
from studio.apps.model_service.admission.admission import ModelAdmission
from studio.apps.model_service.admission.quotas import QuotaPolicies
assert 'app.runtime.db' not in sys.modules
assert 'app.orm' not in sys.modules
assert 'app.console.models' not in sys.modules
assert 'app.console.schemas.platform_governance' not in sys.modules
assert not any(name.startswith('app.apps.') for name in sys.modules)
""",
        ],
        cwd=Path(__file__).resolve().parents[1],
        env={**os.environ, "PYTHONPATH": str(Path(__file__).resolve().parents[1] / "backend")},
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
