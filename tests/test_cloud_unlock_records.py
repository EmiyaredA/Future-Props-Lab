"""The same cloud grant transaction runs against both isolated SQLite assemblies."""

import asyncio
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.identity.storage.cloud_unlock import CloudUnlockRecords
from studio.apps.identity.storage.models.accounts import AuthSession, User
from studio.apps.identity.storage.models.cloud import CloudUnlock
from studio.apps.identity.use_cases.cloud_unlock import CloudUnlockError
from studio.assembly.website.models import WebsiteSession
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.sessions import Database
from studio.runtime.database.website import WebsiteDatabase

DATE = datetime(2027, 1, 15)
DEADLINE = int(DATE.replace(tzinfo=UTC).timestamp()) + 900
MODELS = (User, AuthSession, CloudUnlock)


def actor(owner):
    return StudioPrincipal(
        user_id=owner,
        session_id=owner + "-session",
        platform_role="admin",
        must_change_password=False,
        auth_kind="session",
        scopes=role_scopes("admin"),
    )


@pytest.fixture(params=["website", "independent"])
async def case(request, tmp_path):
    clock = SimpleNamespace(now=DATE)
    policy = SimpleNamespace(
        fpl_cloud_control_enabled=True,
        fpl_cloud_control_public_enabled=True,
        fpl_cloud_control_public_desktop_vnc_only=False,
        fpl_cloud_control_admin_user_ids=os.pathsep.join(("alice", "bob")),
    )
    database = (
        Database("identity", tmp_path, models=MODELS, account_models=())
        if request.param == "independent"
        else WebsiteDatabase(
            f"sqlite+aiosqlite:///{tmp_path / 'website.db'}", session_class=WebsiteSession
        )
    )
    async with database.engine.begin() as connection:
        for model in MODELS:
            await connection.run_sync(model.__table__.create)
    async with database.sessions() as db:
        for owner in ("alice", "bob"):
            db.add(
                User(
                    id=owner,
                    username=owner,
                    username_normalized=owner,
                    password_hash="isolated-test-only",
                    platform_role="admin",
                    must_change_password=False,
                )
            )
        await db.flush()
        for owner in ("alice", "bob"):
            db.add(
                AuthSession(
                    id=owner + "-session",
                    user_id=owner,
                    token_hash=owner,
                    csrf_hash=owner,
                    created_at=DATE - timedelta(hours=1),
                    reauthenticated_at=DATE if owner == "alice" else DATE - timedelta(hours=1),
                    idle_expires_at=DATE + timedelta(hours=1),
                    absolute_expires_at=DATE + timedelta(days=1),
                )
            )
        await db.commit()

    try:
        yield SimpleNamespace(
            store=CloudUnlockRecords(
                database.sessions, clock=lambda: clock.now, settings_reader=lambda: policy
            ),
            database=database,
            clock=clock,
            policy=policy,
        )
    finally:
        await database.close()


async def test_grants_for_both_purposes_commit_without_overwriting_each_other(case):
    await asyncio.gather(
        case.store.grant(actor("alice"), "agent", local=True),
        case.store.grant(actor("alice"), "desktop", local=False),
    )
    async with case.database.sessions() as db:
        grant = await db.get(CloudUnlock, "alice-session")
        assert grant.owner_user_id == "alice"
        assert grant.desktop_verified
        assert grant.expires_at == DEADLINE
    with pytest.raises(CloudUnlockError) as error:
        await case.store.grant(
            replace(actor("alice"), session_id="bob-session"), "desktop", local=False
        )
    assert error.value.status == 401


async def test_grant_requires_reauthentication_after_login_within_ten_minutes(case):
    for principal, now in (
        (actor("bob"), DATE),
        (actor("alice"), DATE + timedelta(minutes=10, seconds=1)),
    ):
        case.clock.now = now
        with pytest.raises(CloudUnlockError) as error:
            await case.store.grant(principal, "agent", local=True)
        assert error.value.code == "reauthentication_required"
    async with case.database.sessions() as db:
        assert await db.get(CloudUnlock, "alice-session") is None
        assert await db.get(CloudUnlock, "bob-session") is None


async def test_grant_checks_current_entry_and_account_policy(case):
    with pytest.raises(CloudUnlockError) as error:
        await case.store.grant(actor("alice"), "desktop", local=True)
    assert error.value.code == "cloud_unlock_forbidden"
    case.policy.fpl_cloud_control_public_enabled = False
    with pytest.raises(CloudUnlockError) as error:
        await case.store.grant(actor("alice"), "desktop", local=False)
    assert error.value.code == "cloud_unlock_forbidden"
    case.policy.fpl_cloud_control_admin_user_ids = "bob"
    with pytest.raises(CloudUnlockError) as error:
        await case.store.grant(actor("alice"), "agent", local=True)
    assert error.value.code == "cloud_unlock_forbidden"


async def test_grant_rechecks_revocation_at_commit_boundary(case):
    async with case.database.sessions() as db:
        session = await db.get(AuthSession, "alice-session")
        session.revoked_at = DATE
        await db.commit()
    with pytest.raises(CloudUnlockError) as error:
        await case.store.grant(actor("alice"), "agent", local=True)
    assert error.value.status == 401


@pytest.mark.parametrize("failure", ["cancel", "rollback", "lost-ack"])
async def test_grant_commit_failure_and_unknown_result(case, monkeypatch, failure):
    original = AsyncSession.commit

    async def interrupted(db):
        if failure == "lost-ack":
            await original(db)
        elif failure == "rollback":
            await db.flush()
        if failure == "cancel":
            raise asyncio.CancelledError
        raise OSError("isolated interrupted commit")

    with monkeypatch.context() as scope:
        scope.setattr(AsyncSession, "commit", interrupted)
        with pytest.raises((asyncio.CancelledError, OSError)):
            await case.store.grant(actor("alice"), "agent", local=True)
    async with case.database.sessions() as db:
        grant = await db.get(CloudUnlock, "alice-session")
        assert (grant.expires_at if grant else None) == (
            DEADLINE if failure == "lost-ack" else None
        )
