"""The Identity destination accepts original Studio credentials after import."""

import hashlib
import json
import time
from datetime import timedelta
from io import BytesIO
from uuid import UUID, uuid4

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image
from scripts.website.migrate_identity import CREDENTIALS
from scripts.website.migrate_identity_avatars import transfer_avatars
from scripts.website.migration_transfer import pages, transfer
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from starlette.datastructures import Headers, UploadFile
from tests.test_community_asset_protocol import CATALOG, GATEWAY_SECRET, PASSWORD
from tests.test_tools_navigation_migration import available_ports, listener

from app.capabilities.identity.security import CSRF_COOKIE, SESSION_COOKIE
from app.capabilities.identity.session_policy import MANAGEMENT_SESSION
from app.console.cloud_control.access import start_enrollment, totp, verify
from app.console.governance.account_creation import create_account
from app.console.governance.profile import apply_avatar, stage_avatar
from app.console.governance.registration import change_invite, create_invite, register
from app.console.governance.service import complete_login, create_api_key
from app.console.schemas.registration import (
    RegistrationIn,
    RegistrationInviteAction,
    RegistrationInviteIn,
)
from app.runtime.config import get_settings
from db.migrations import apply_migrations
from studio.apps.identity.avatar_migration import AVATAR_PATH, DIGEST_HEADER
from studio.apps.identity.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.identity.application import create_app
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import role_scopes
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.migrations import apply
from studio.runtime.time import utc_now

pytestmark = pytest.mark.real_auth


async def make_legacy(path):
    apply_migrations(path)
    engine = create_async_engine(f"sqlite+aiosqlite:///{path}")
    sessions = async_sessionmaker(engine, expire_on_commit=False)

    async def skip_catalog(_session, _id, _role):
        pass

    try:
        async with sessions() as session:
            owner, _ = await create_account(
                session,
                initializer=skip_catalog,
                username="MigratedAdmin",
                display_name="Migrated Admin",
                platform_role="admin",
                password=PASSWORD,
            )
            _, auth, raw, csrf = await complete_login(
                session, username=owner.username, password=PASSWORD, client_ip="", user_agent=""
            )
            principal = StudioPrincipal(
                user_id=owner.id,
                must_change_password=False,
                auth_kind="session",
                scopes=role_scopes(owner.platform_role),
                platform_role=owner.platform_role,
                session_id=auth.id,
            )
            invite = await create_invite(
                session, principal, RegistrationInviteIn(name="Restored invitation", max_uses=2), ""
            )
            deleted = await create_invite(
                session, principal, RegistrationInviteIn(name="Deleted invitation"), ""
            )
            await change_invite(
                session,
                principal,
                deleted["invite"]["id"],
                RegistrationInviteAction(expected_revision=0, action="delete"),
                "",
            )

            async def create_registered(db, **values):
                return await create_account(db, initializer=skip_catalog, **values)

            other, *_ = await register(
                session,
                RegistrationIn(
                    username="migrated-user",
                    display_name="Migrated User",
                    password=PASSWORD,
                    invite_code=invite["secret"],
                ),
                "",
                "",
                account_creator=create_registered,
            )
            assert (
                await complete_login(
                    session,
                    username="unknown-account",
                    password=PASSWORD,
                    client_ip="",
                    user_agent="",
                )
                is None
            )
            key, raw_key = await create_api_key(
                session,
                principal,
                name="Retained key",
                scopes=["studio:read"],
                expires_in_days=7,
                client_ip="",
            )
            revoked, raw_revoked = await create_api_key(
                session,
                principal,
                name="Revoked key",
                scopes=["studio:write"],
                expires_in_days=7,
                client_ip="",
            )
            # Test-only state covers already-revoked historical credentials.
            revoked.revoked_at = utc_now() - timedelta(minutes=10)
            await session.commit()
            await session.refresh(owner)
            await session.refresh(other)
            await session.refresh(key)
            avatar = BytesIO()
            Image.new("RGB", (5, 5), "blue").save(avatar, format="PNG")
            original = avatar.getvalue()
            avatar.seek(0)
            staged = await stage_avatar(
                UploadFile(
                    avatar, filename="avatar.png", headers=Headers({"Content-Type": "image/png"})
                )
            )
            owner = await apply_avatar(
                session,
                user_id=owner.id,
                staged=staged,
                expected_revision=owner.revision,
                client_ip="",
            )
            secret = await start_enrollment(session, principal)
            used_code = totp(secret, int(time.time()) // 30)
            await verify(session, principal, used_code, enroll=True)
            return (
                owner.id,
                other.id,
                raw,
                csrf,
                key.id,
                raw_key,
                raw_revoked,
                original,
                secret,
                used_code,
                invite,
                deleted["invite"]["id"],
            )
    finally:
        await engine.dispose()


async def test_import_keeps_account_scope_and_existing_credentials(tmp_path, monkeypatch):
    legacy = tmp_path / "legacy.db"
    monkeypatch.setenv("FPL_DATABASE_PATH", str(legacy))
    get_settings.cache_clear()
    try:
        (
            owner,
            other,
            token,
            csrf,
            key_id,
            raw_key,
            revoked_key,
            avatar,
            secret,
            used_code,
            invite,
            deleted_id,
        ) = await make_legacy(legacy)
    finally:
        get_settings.cache_clear()
    digest = hashlib.sha256(legacy.read_bytes()).hexdigest()
    plan = MigrationPlan(
        run_id=uuid4(),
        source_revision="b" * 40,
        source_database_sha256=digest,
        owner_ids=(UUID(owner), UUID(other)),
        token="identity-synthetic-migration-credential",
    )
    plan_file = tmp_path / "plan.json"
    plan_file.touch(mode=0o600)
    plan_file.write_text(
        json.dumps(
            {
                **plan.model_dump(mode="json", exclude={"token"}),
                "token": plan.token.get_secret_value(),
            }
        )
    )
    target = tmp_path / "identity"
    apply(target / "service.db", "identity", MIGRATIONS)
    source_port, target_port = available_ports()
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    common = {"module": "studio.assembly.independent.identity.cli", "prefix": CREDENTIALS[0].prefix}

    with (
        httpx.Client(timeout=5, trust_env=False) as client,
        listener(
            client, source_port, "migration-export", plan_file, "--legacy-db", legacy, **common
        ) as source,
        listener(
            client, target_port, "migration-import", plan_file, "--state-root", target, **common
        ) as dest,
    ):
        session_data = CREDENTIALS[1]
        page = next(pages(client, source, headers, plan, UUID(owner), session_data))
        path = f"{dest}{session_data.prefix}/batches"
        response = client.post(
            path,
            json=page.batch.model_dump(mode="json"),
            headers={**headers, "X-Fpl-Migration-SHA256": page.sha256},
        )
        assert response.status_code == 409
        assert response.json()["code"] == "migration_owner_missing"
        account_path = f"{dest}{CREDENTIALS[0].prefix}/batches"
        invalid = client.post(account_path, headers=headers, json={"token_hash": "private-echo"})
        assert invalid.status_code == 422 and "private-echo" not in invalid.text
        invites, redemptions, audit = CREDENTIALS[-3:]
        assert client.get(f"{source}{invites.prefix}/{owner}", headers=headers).status_code == 409
        assert (
            client.get(f"{source}{redemptions.prefix}/{plan.run_id}", headers=headers).status_code
            == 409
        )
        reports = [transfer(client, plan, source, dest, dataset) for dataset in CREDENTIALS]
        assert [report["record_count"] for report in reports[:-1]] == [2, 2, 2, 1, 1, 2, 1]
        assert reports[-1]["record_count"] > 0
        original_audit = next(pages(client, source, headers, plan, plan.run_id, audit))
        assert any(record.actor_user_id is None for record in original_audit.batch.records)
        assert any(
            record.event_type == "registration_invite.redeemed" and record.owner_user_id == other
            for record in original_audit.batch.records
        )
        assert reports == [transfer(client, plan, source, dest, dataset) for dataset in CREDENTIALS]

        avatar_path = f"{AVATAR_PATH}/{owner}"
        expected = hashlib.sha256(avatar).hexdigest()
        corrupt = client.put(
            dest + avatar_path,
            headers={**headers, DIGEST_HEADER: expected, "Content-Type": "image/png"},
            content=b"wrong bytes",
        )
        assert corrupt.status_code == 422
        unknown = client.get(f"{source}{AVATAR_PATH}/{uuid4()}", headers=headers)
        assert unknown.status_code == 409
        # A process may have stopped after staging bytes and before publication.
        staging = target / "profiles/.staging"
        staging.mkdir(parents=True)
        (staging / ".import-interrupted").write_bytes(b"partial stage")
        report = transfer_avatars(client, plan, source, dest)
        assert report["record_count"] == 1 and report["byte_count"] == len(avatar)
        assert transfer_avatars(client, plan, source, dest) == report
        unexpected = legacy.parent / "profiles" / owner / "unassigned.png"
        unexpected.write_bytes(avatar)
        assert client.get(f"{source}{AVATAR_PATH}/inventory", headers=headers).status_code == 409
        unexpected.unlink()

    assert hashlib.sha256(legacy.read_bytes()).hexdigest() == digest
    monkeypatch.setenv("FPL_DATABASE_PATH", str(target / "service.db"))
    get_settings.cache_clear()
    settings = get_settings()
    monkeypatch.setattr(settings, "fpl_cloud_control_enabled", True)
    monkeypatch.setattr(settings, "fpl_cloud_control_admin_user_ids", owner)
    key = Ed25519PrivateKey.generate()
    management_token = "credential-migration-management-gateway-" * 2
    app = create_app(
        state_root=target,
        catalog=CATALOG,
        gateway_token=GATEWAY_SECRET,
        local_origin="http://127.0.0.1:19000",
        public_origin="https://studio.example.test",
        private_key=key,
        management_gateway_token=management_token,
    )
    try:
        async with (
            app.router.lifespan_context(app),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://127.0.0.1:19000",
                headers={"X-Fpl-Gateway": GATEWAY_SECRET, "X-Fpl-Ingress": "local"},
            ) as api,
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app),
                base_url="http://127.0.0.1:9002",
                headers={"X-Fpl-Gateway": management_token, "X-Fpl-Ingress": "local"},
            ) as management,
        ):
            api.cookies.set(SESSION_COOKIE, token)
            api.cookies.set(CSRF_COOKIE, csrf)
            me = await api.get("/v1/auth/me")
            assert me.status_code == 200
            assert me.json()["user"]["id"] == owner
            assert "cloud-control.access" in me.json()["permission_keys"]
            profile_avatar = await api.get("/v1/account/profile/avatar")
            assert profile_avatar.status_code == 200
            assert profile_avatar.content == avatar

            factor = "/v1/cloud-control/totp"
            csrf_headers = {"X-CSRF-Token": csrf, "Origin": "http://127.0.0.1:19000"}
            assert (await api.post(factor + "/enroll")).status_code == 403
            replay = await api.post(
                factor + "/verify", headers=csrf_headers, json={"code": used_code}
            )
            assert replay.status_code == 403
            current_code = totp(secret, int(time.time()) // 30 + 1)
            verified = await api.post(
                factor + "/verify", headers=csrf_headers, json={"code": current_code}
            )
            assert verified.status_code == 204
            rejected_public = await api.post(
                "https://studio.example.test" + factor + "/enroll",
                headers={
                    "X-Fpl-Ingress": "public",
                    "X-CSRF-Token": csrf,
                    "Origin": "https://studio.example.test",
                },
            )
            assert rejected_public.status_code == 403
            enrollment = await api.post(factor + "/enroll", headers=csrf_headers)
            assert enrollment.status_code == 200
            assert enrollment.headers["Cache-Control"] == "no-store"
            code = totp(enrollment.json()["secret"], int(time.time()) // 30)
            assert (
                await api.post(factor + "/confirm", headers=csrf_headers, json={"code": code})
            ).status_code == 204
            assert (
                await api.post(factor + "/verify", headers=csrf_headers, json={"code": code})
            ).status_code == 403
            retained = await api.get("/v1/account/api-keys")
            assert retained.status_code == 200
            assert {entry["name"] for entry in retained.json()} == {"Retained key", "Revoked key"}

            invites_path = "/v1/platform/registration-invite-codes"
            assert (await api.get(invites_path)).status_code == 404
            signed_in = await management.post(
                "/v1/auth/login", json={"username": "MigratedAdmin", "password": PASSWORD}
            )
            assert signed_in.status_code == 200
            management_csrf = {
                "Origin": "http://127.0.0.1:9002",
                "X-CSRF-Token": management.cookies[MANAGEMENT_SESSION.csrf_cookie],
            }
            active = (await management.get(invites_path)).json()["items"]
            assert [item["id"] for item in active] == [invite["invite"]["id"]]
            assert active[0]["used_count"] == 1 and active[0]["revision"] == 1
            deleted_page = await management.get(invites_path, params={"status": "deleted"})
            deleted = deleted_page.json()["items"]
            assert [item["id"] for item in deleted] == [deleted_id]
            invite_path = f"{invites_path}/{active[0]['id']}"
            history = (await management.get(invite_path + "/redemptions")).json()["items"]
            assert [item["username"] for item in history] == ["migrated-user"]
            reveal = await management.post(invite_path + "/secret", headers=management_csrf)
            assert reveal.status_code == 200 and reveal.json()["secret"] == invite["secret"]
            failures = await management.get(
                "/v1/platform/security-events",
                params={"event_type": "auth.login", "outcome": "failure"},
            )
            source_failures = {
                record.id
                for record in original_audit.batch.records
                if record.event_type == "auth.login" and record.outcome == "failure"
            }
            assert {event["id"] for event in failures.json()["items"]} == source_failures

            api.cookies.clear()
            endpoint = "/v1/model-inference/options"
            key_headers = {
                "X-Fpl-Target-Service": "models",
                "X-Fpl-Request-Method": "GET",
                "X-Fpl-Request-Uri": endpoint,
            }
            approved = await api.get(
                "/_internal/v1/authorize",
                headers={**key_headers, "Authorization": f"Bearer {raw_key}"},
            )
            assert approved.status_code == 204
            actor = verify_context(
                approved.headers[HEADER],
                service="models",
                method="GET",
                path=endpoint,
                public_key=key.public_key(),
            )
            assert actor.user_id == owner and actor.api_key_id == key_id
            assert "studio:write" not in actor.scopes
            revoked = await api.get(
                "/_internal/v1/authorize",
                headers={**key_headers, "Authorization": f"Bearer {revoked_key}"},
            )
            assert revoked.status_code == 401
            login = await api.post(
                "/v1/auth/login",
                json={"username": "migrated-user", "password": PASSWORD},
            )
            assert login.status_code == 200 and login.json()["user"]["id"] == other
            profile = await api.get("/v1/auth/me")
            assert "cloud-control.access" not in profile.json()["permission_keys"]
            assert (await api.get("/v1/account/api-keys")).json() == []
            assert (await api.get("/v1/account/profile/avatar")).status_code == 404
    finally:
        get_settings.cache_clear()
