"""The same factor contract runs in memory and both isolated SQLite assemblies."""

import asyncio
import base64
from dataclasses import replace
from datetime import datetime, timedelta
from types import SimpleNamespace

import pytest
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.identity.storage.cloud_factors import FactorRecords
from studio.apps.identity.storage.models.accounts import AuthSession, User
from studio.apps.identity.storage.models.cloud import CloudFactor, CloudUnlock
from studio.apps.identity.use_cases.cloud_factors import CloudFactors, FactorError, totp
from studio.assembly.website.models import WebsiteSession
from studio.contracts.identity.principal import StudioPrincipal
from studio.runtime.database.sessions import Database
from studio.runtime.database.website import WebsiteDatabase
from studio.runtime.secrets import SecretCipher

NOW = 1_800_000_000
DATE = datetime(2027, 1, 15)
MODELS = (User, AuthSession, CloudFactor, CloudUnlock)


def actor(owner):
    return StudioPrincipal(
        user_id=owner,
        session_id=owner + "-session",
        platform_role="admin",
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset(),
    )


class MemoryFactors:
    def __init__(self):
        self.factors = {}
        self.unlocks = {}
        self.revoked = set()
        self.lock = asyncio.Lock()

    async def update(self, principal, decide, *, public):
        async with self.lock:
            owner = principal.user_id
            if (
                owner not in {"alice", "bob"}
                or principal.session_id != owner + "-session"
                or owner in self.revoked
                or principal.auth_kind != "session"
            ):
                raise FactorError(401, "账号会话已失效")
            if public and owner == "bob":
                raise FactorError(403, {"code": "reauthentication_required"})
            decision = decide(self.factors.get(owner))
            if decision.factor is not None:
                self.factors[owner] = decision.factor
            if decision.revoke_unlocks:
                self.unlocks = {k: v for k, v in self.unlocks.items() if v[0] != owner}
            if decision.desktop or decision.unlock_until is not None:
                old = self.unlocks.get(principal.session_id, (owner, 0, False))
                self.unlocks[principal.session_id] = (
                    owner,
                    old[1] if decision.desktop else decision.unlock_until,
                    old[2] or decision.desktop,
                )
            return decision


@pytest.fixture(params=["memory", "website", "independent"])
async def case(request, tmp_path):
    cipher = SecretCipher(Fernet.generate_key().decode())
    clock = SimpleNamespace(now=NOW)
    database = None
    if request.param == "memory":
        store = MemoryFactors()
    else:
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
        store = FactorRecords(database.sessions, clock=lambda: DATE)
    factors = CloudFactors(
        store, cipher=cipher, clock=lambda: clock.now, secret_bytes=lambda n: b"a" * n
    )
    try:
        yield SimpleNamespace(store=store, factors=factors, database=database, clock=clock)
    finally:
        if database:
            await database.close()


async def enroll(case, owner="alice"):
    secret = await case.factors.enroll(actor(owner))
    await case.factors.verify(actor(owner), totp(secret, case.clock.now // 30), enroll=True)
    return secret


async def test_factor_contract_concurrent_replay_and_account_isolation(case):
    secret = await enroll(case)
    code = totp(secret, NOW // 30 + 1)
    results = await asyncio.gather(
        *(case.factors.verify(actor("alice"), code, desktop=True, public=True) for _ in range(2)),
        return_exceptions=True,
    )
    assert results.count(None) == 1
    assert [(v.status, v.detail) for v in results if isinstance(v, FactorError)] == [
        (403, "验证码无效或已使用")
    ]
    with pytest.raises(FactorError) as error:
        await case.factors.verify(actor("bob"), code)
    assert error.value.status == 409
    with pytest.raises(FactorError) as error:
        await case.factors.enroll(replace(actor("alice"), session_id="bob-session"))
    assert error.value.status == 401


async def test_factor_contract_attempts_expiry_and_public_reauthentication(case):
    secret = await case.factors.enroll(actor("bob"))
    with pytest.raises(FactorError) as error:
        await case.factors.verify(actor("bob"), totp(secret, NOW // 30), enroll=True, public=True)
    assert error.value.status == 403
    valid = {totp(secret, NOW // 30 + offset) for offset in (-1, 0, 1)}
    wrong = next(f"{n:06}" for n in range(10) if f"{n:06}" not in valid)
    for _ in range(5):
        with pytest.raises(FactorError) as error:
            await case.factors.verify(actor("bob"), wrong, enroll=True)
        assert error.value.status == 403
    with pytest.raises(FactorError) as error:
        await case.factors.verify(actor("bob"), totp(secret, NOW // 30), enroll=True)
    assert error.value.status == 429
    case.clock.now += 301
    with pytest.raises(FactorError) as error:
        await case.factors.verify(actor("bob"), totp(secret, case.clock.now // 30), enroll=True)
    assert error.value.status == 409


async def test_factor_contract_revocation_checked_at_commit_boundary(case):
    if case.database:
        async with case.database.sessions() as db:
            session = await db.get(AuthSession, "alice-session")
            session.revoked_at = DATE
            await db.commit()
    else:
        case.store.revoked.add("alice")
    with pytest.raises(FactorError) as error:
        await case.factors.enroll(actor("alice"))
    assert error.value.status == 401


async def test_factor_contract_rotation_revokes_desktop_proof(case):
    secret = await enroll(case)
    await case.factors.verify(actor("alice"), totp(secret, NOW // 30 + 1), desktop=True)
    case.factors.secret_bytes = lambda n: b"b" * n
    await enroll(case)
    if case.database:
        async with case.database.sessions() as db:
            unlock = await db.get(CloudUnlock, "alice-session")
            assert not unlock.desktop_verified and unlock.expires_at == NOW + 900
    else:
        assert case.store.unlocks["alice-session"] == ("alice", NOW + 900, False)


@pytest.mark.parametrize("failure", ["cancel", "rollback", "lost-ack"])
async def test_factor_commit_failure_and_unknown_result(case, monkeypatch, failure):
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
        if case.database:
            scope.setattr(AsyncSession, "commit", interrupted)
        else:
            update = case.store.update

            async def interrupted_memory(*args, **kwargs):
                if failure == "lost-ack":
                    await update(*args, **kwargs)
                if failure == "cancel":
                    raise asyncio.CancelledError
                raise OSError("isolated interrupted commit")

            scope.setattr(case.store, "update", interrupted_memory)
        with pytest.raises((asyncio.CancelledError, OSError)):
            await case.factors.enroll(actor("alice"))
    if case.database:
        async with case.database.sessions() as db:
            factor = await db.get(CloudFactor, "alice")
    else:
        factor = case.store.factors.get("alice")
    assert (factor is not None) == (failure == "lost-ack")
    if failure == "lost-ack":
        # Reopen the adapter after an unknown response: persisted enrollment is
        # usable without blindly repeating a command that might already commit.
        if case.database:
            case.factors.store = FactorRecords(case.database.sessions, clock=lambda: DATE)
        secret = base64.b32encode(b"a" * 20).decode()
        await case.factors.verify(actor("alice"), totp(secret, NOW // 30), enroll=True)
