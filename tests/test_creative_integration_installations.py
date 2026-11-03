"""Creative bundle installs are actor-bound, atomic and repeat the original receipt."""

import asyncio
import hashlib
import io
import json
import time
import zipfile
from dataclasses import replace
from types import SimpleNamespace
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
from cryptography.fernet import Fernet
from fastapi import HTTPException
from sqlalchemy import select

from app.integrations.models import (
    McpIntegration,
    SkillIntegration,
    SkillVersion,
    ToolApiIntegration,
)
from app.runtime.config import Settings
from fpl_integrations.creative_installations import CreativeInstallations
from fpl_integrations.creative_records import CreativeInstalledPart, CreativeInstallReceipt
from fpl_integrations.migrations.registry import MIGRATIONS
from fpl_integrations.models import MODELS
from fpl_runtime.creative_integrations import (
    CreativeInstallBatch,
    CreativeInstallPart,
    CreativeOperationGrant,
    CreativeSkillBlob,
    CreativeStdioConfiguration,
)
from fpl_runtime.database import Database
from fpl_runtime.integration_intents import digest
from fpl_runtime.migrations import apply


class Incoming:
    def __init__(self, data):
        self.data = io.BytesIO(data)

    async def read(self, size=-1):
        return self.data.read(size)

    async def close(self):
        self.data.close()


def zip_bytes():
    value = io.BytesIO()
    with zipfile.ZipFile(value, "w") as archive:
        archive.writestr(
            "SKILL.md", "---\nname: sample\ndescription: Example skill\n---\n# Hello\n"
        )
        archive.writestr("notes/text.txt", "safe content")
    return value.getvalue()


def skill_part(data):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        expanded = sum(item.file_size for item in archive.infolist())
        digest = hashlib.sha256(b"fpl-skill-tree-v1\0")
        for item in sorted(archive.infolist(), key=lambda value: value.filename.encode("utf-8")):
            name = item.filename.encode("utf-8")
            digest.update(len(name).to_bytes(4, "big"))
            digest.update(name)
            digest.update(item.file_size.to_bytes(8, "big"))
            digest.update(hashlib.sha256(archive.read(item)).digest())
    return CreativeInstallPart(
        release_id="skill-release",
        kind="skill",
        title="Example skill",
        target_name="My Skill",
        summary="Useful skill",
        tags=["demo"],
        manifest={"name": "sample"},
        skill=CreativeSkillBlob(
            tree_sha256=digest.hexdigest(),
            sha256=hashlib.sha256(data).hexdigest(),
            byte_size=len(data),
            file_count=2,
            expanded_bytes=expanded,
        ),
    )


def tool(name="My Tool"):
    return CreativeInstallPart(
        release_id="tool-release",
        kind="tool_api",
        title="Tool",
        target_name=name,
        summary="Find items",
        manifest={"method": "GET", "url": "https://example.test/api"},
    )


def stdio():
    return CreativeInstallPart(
        release_id="mcp-release",
        kind="mcp",
        title="MCP",
        target_name="My MCP",
        summary="MCP server",
        manifest={"transport": "stdio", "command_hint": "install MCP"},
    )


def batch(parts, operation="batch-one"):
    return CreativeInstallBatch(
        operation_id=str(uuid5(NAMESPACE_URL, operation)), root_release_id="bundle-one", parts=parts
    )


def granted(value, purpose="install", owner="alpha", *, invalid=False):
    fingerprint = digest(value.model_dump(mode="json"))
    operation = value.operation_id if hasattr(value, "operation_id") else value.release_id

    async def authorize():
        return CreativeOperationGrant(
            owner, purpose, operation, "f" * 64 if invalid else fingerprint, int(time.time()) + 5
        )

    return authorize


@pytest.fixture
async def installation(tmp_path):
    settings = Settings(
        _config_file=None,
        fpl_database_path=str(tmp_path / "service.db"),
        fpl_secrets_key=Fernet.generate_key().decode(),
    )
    apply(settings.database_path, "integrations", MIGRATIONS)
    database = Database(
        "integrations",
        tmp_path,
        models=MODELS,
        account_models=tuple(m for m in MODELS if hasattr(m, "owner_user_id")),
    )
    try:
        yield SimpleNamespace(
            db=database, settings=settings, use=CreativeInstallations(database, settings)
        )
    finally:
        await database.close()


@pytest.mark.asyncio
async def test_mixed_bundle_commits_once_and_reuses_component_receipts(installation):
    data = zip_bytes()
    value = batch([tool(), stdio(), skill_part(data)])
    first = await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    assert [item["state"] for item in first["resources"]] == [
        "disabled",
        "pending_setup",
        "disabled",
    ]
    assert await installation.use.install(value, {}, granted(value)) == first
    another = batch([skill_part(data)], "another-batch")
    assert (await installation.use.install(another, {}, granted(another)))["resources"] == [
        first["resources"][2]
    ]
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert len(list(await session.scalars(select(ToolApiIntegration)))) == 1
        assert len(list(await session.scalars(select(SkillIntegration)))) == 1
        assert len(list(await session.scalars(select(CreativeInstalledPart)))) == 3
        version = await session.scalar(select(SkillVersion))
        assert (
            installation.settings.runtime_path
            / "accounts/alpha/integrations/skills"
            / first["resources"][2]["resource_id"]
            / "v1/SKILL.md"
        ).is_file()
        assert version.content_sha256 == hashlib.sha256(data).hexdigest()


@pytest.mark.asyncio
async def test_changed_batch_and_cross_account_cannot_replay_receipts(installation):
    value = batch([tool()])
    first = await installation.use.install(value, {}, granted(value))
    with pytest.raises(HTTPException) as error:
        await installation.use.install(
            batch([tool("Changed")]), {}, granted(batch([tool("Changed")]))
        )
    assert error.value.status_code == 409
    other = await installation.use.install(value, {}, granted(value, owner="beta"))
    assert other["resources"][0]["resource_id"] != first["resources"][0]["resource_id"]
    with pytest.raises(HTTPException) as error:
        await installation.use.install(
            batch([tool()], "bad"), {}, granted(batch([tool()], "bad"), invalid=True)
        )
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_mixed_batch_conflict_rolls_back_and_removes_uncommitted_skill(installation):
    data = zip_bytes()
    same_name = tool("duplicate")
    second = CreativeInstallPart(
        release_id="tool-2",
        kind="tool_api",
        title="Two",
        target_name="Duplicate",
        summary="",
        manifest={"url": "https://example.test/other"},
    )
    value = batch([skill_part(data), same_name, second])
    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    assert error.value.status_code == 409
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert list(await session.scalars(select(CreativeInstallReceipt))) == []
        assert list(await session.scalars(select(SkillIntegration))) == []
    root = installation.settings.runtime_path / "accounts/alpha/integrations/skills"
    assert not any(root.rglob("SKILL.md"))


@pytest.mark.asyncio
async def test_stdio_setup_encrypts_secret_and_replays_exact_payload(installation):
    value = batch([stdio()])
    await installation.use.install(value, {}, granted(value))
    body = CreativeStdioConfiguration(
        release_id="mcp-release",
        command="/usr/bin/example",
        arguments=["serve"],
        environment={"API_KEY": "synthetic-secret"},
    )
    first = await installation.use.configure_stdio(body, granted(body, "setup"))
    assert first["state"] == "disabled" and first["resource_id"]
    assert await installation.use.configure_stdio(body, granted(body, "setup")) == first
    changed = body.model_copy(update={"environment": {"API_KEY": "changed-secret"}})
    with pytest.raises(HTTPException) as error:
        await installation.use.configure_stdio(changed, granted(changed, "setup"))
    assert error.value.status_code == 409
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        installed = await session.get(McpIntegration, first["resource_id"])
        record = await session.scalar(select(CreativeInstalledPart))
        assert "synthetic-secret" not in json.dumps(record.result)
        assert "synthetic-secret" not in installed.environment_ciphertext
        assert (
            json.loads(installation.use.cipher.decrypt(installed.environment_ciphertext))
            == body.environment
        )


@pytest.mark.asyncio
async def test_same_batch_concurrency_has_one_owned_receipt(installation):
    value = batch([tool()])
    a, b = await asyncio.gather(
        installation.use.install(value, {}, granted(value)),
        installation.use.install(value, {}, granted(value)),
    )
    assert a == b
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert len(list(await session.scalars(select(CreativeInstallReceipt)))) == 1
        assert len(list(await session.scalars(select(ToolApiIntegration)))) == 1


@pytest.mark.asyncio
async def test_preview_and_receipt_are_owner_scoped_and_revalidate_authority(installation):
    value = batch([tool()])
    assert (await installation.use.preview(value, granted(value, "preview")))["installable"]
    assert await installation.use.receipt(value, granted(value, "receipt")) is None
    first = await installation.use.install(value, {}, granted(value))
    assert await installation.use.receipt(value, granted(value, "receipt")) == first
    replay = await installation.use.preview(value, granted(value, "preview"))
    assert replay["parts"][0]["already_installed"]
    assert await installation.use.receipt(value, granted(value, "receipt", owner="beta")) is None
    calls = 0

    async def revoked():
        nonlocal calls
        calls += 1
        grant = await granted(value, "preview")()
        return grant if calls == 1 else replace(grant, owner_user_id="beta")

    with pytest.raises(HTTPException) as error:
        await installation.use.preview(value, revoked)
    assert error.value.status_code == 403


@pytest.mark.asyncio
async def test_lost_commit_response_preserves_files_and_reuses_target_receipt(
    installation, monkeypatch
):
    data = zip_bytes()
    value = batch([skill_part(data)])
    original = installation.db.sessions
    lost = False

    def sessions(**kwargs):
        nonlocal lost
        session = original(**kwargs)
        commit = session.commit

        async def lost_response():
            nonlocal lost
            await commit()
            if not lost:
                lost = True
                raise RuntimeError("synthetic lost commit response")

        session.commit = lost_response
        return session

    monkeypatch.setattr(installation.db, "sessions", sessions)
    with pytest.raises(RuntimeError, match="lost commit"):
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    recovered = await installation.use.install(value, {}, granted(value))
    assert (
        installation.settings.runtime_path
        / "accounts/alpha/integrations/skills"
        / recovered["resources"][0]["resource_id"]
        / "v1/SKILL.md"
    ).is_file()
    assert await installation.use.receipt(value, granted(value, "receipt")) == recovered


@pytest.mark.asyncio
async def test_bad_or_cancelled_archive_never_commits(installation):
    data = zip_bytes()
    bad = skill_part(data).model_copy(
        update={"skill": skill_part(data).skill.model_copy(update={"sha256": "f" * 64})}
    )
    value = batch([bad])
    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    assert error.value.status_code == 422
    assert await installation.use.receipt(value, granted(value, "receipt")) is None
    root = installation.settings.runtime_path / "accounts/alpha/integrations/skills"
    assert not any(root.rglob("SKILL.md"))


@pytest.mark.asyncio
async def test_published_tree_digest_rejects_different_unpacked_content(installation):
    data = zip_bytes()
    part = skill_part(data)
    wrong = part.model_copy(
        update={"skill": part.skill.model_copy(update={"tree_sha256": "f" * 64})}
    )
    value = batch([wrong])
    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    assert error.value.status_code == 422
    assert await installation.use.receipt(value, granted(value, "receipt")) is None


@pytest.mark.asyncio
async def test_revocation_after_staging_stops_before_install_and_cleans_temporary_bytes(
    installation,
):
    data = zip_bytes()
    value = batch([skill_part(data)])
    calls = 0

    async def revoked():
        nonlocal calls
        calls += 1
        assert not installation.db.engine.sync_engine.pool.checkedout()
        current = await granted(value)()
        return current if calls == 1 else replace(current, fingerprint="f" * 64)

    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {"skill-release": Incoming(data)}, revoked)
    assert error.value.status_code == 403
    assert await installation.use.receipt(value, granted(value, "receipt")) is None
    root = installation.settings.runtime_path / "accounts/alpha/integrations/skills"
    assert not any(root.rglob("SKILL.md"))


@pytest.mark.asyncio
async def test_deleted_resource_never_recreated_by_receipt_or_batch_replay(installation):
    from sqlalchemy import delete

    value = batch([tool()])
    result = await installation.use.install(value, {}, granted(value))
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        await session.execute(
            delete(ToolApiIntegration).where(
                ToolApiIntegration.id == result["resources"][0]["resource_id"]
            )
        )
        await session.commit()
    for operation in (
        lambda: installation.use.install(value, {}, granted(value)),
        lambda: installation.use.receipt(value, granted(value, "receipt")),
        lambda: installation.use.preview(value, granted(value, "preview")),
    ):
        with pytest.raises(HTTPException) as error:
            await operation()
        assert error.value.status_code == 409
        assert error.value.detail["code"] == "creative_installed_resource_deleted"
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert list(await session.scalars(select(ToolApiIntegration))) == []


@pytest.mark.asyncio
async def test_lost_commit_then_other_account_uses_name_cannot_change_original_receipt(
    installation, monkeypatch
):
    value = batch([tool()])
    sessions = installation.db.sessions
    called = False

    def lost_sessions(**kwargs):
        session = sessions(**kwargs)
        original = session.commit

        async def lost_response():
            nonlocal called
            await original()
            if not called:
                called = True
                raise RuntimeError("synthetic lost reply")

        session.commit = lost_response
        return session

    monkeypatch.setattr(installation.db, "sessions", lost_sessions)
    with pytest.raises(RuntimeError, match="lost reply"):
        await installation.use.install(value, {}, granted(value))
    monkeypatch.setattr(installation.db, "sessions", sessions)
    other = await installation.use.install(value, {}, granted(value, owner="beta"))
    recovered = await installation.use.install(value, {}, granted(value))
    assert recovered["resources"][0]["resource_id"] != other["resources"][0]["resource_id"]
    assert await installation.use.receipt(value, granted(value, "receipt")) == recovered


@pytest.mark.asyncio
async def test_stdio_concurrent_replays_and_deleted_resource_cannot_recreate(installation):
    from sqlalchemy import delete

    value = batch([stdio()])
    await installation.use.install(value, {}, granted(value))
    body = CreativeStdioConfiguration(
        release_id="mcp-release", command="/usr/bin/example", environment={"TOKEN": "test-secret"}
    )
    left, right = await asyncio.gather(
        installation.use.configure_stdio(body, granted(body, "setup")),
        installation.use.configure_stdio(body, granted(body, "setup")),
    )
    assert left == right
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        await session.execute(
            delete(McpIntegration).where(McpIntegration.id == left["resource_id"])
        )
        await session.commit()
    with pytest.raises(HTTPException) as error:
        await installation.use.configure_stdio(body, granted(body, "setup"))
    assert error.value.detail["code"] == "creative_installed_resource_deleted"
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        assert list(await session.scalars(select(McpIntegration))) == []


@pytest.mark.asyncio
async def test_unknown_rollback_then_same_account_name_conflict_cleans_only_on_recovery(
    installation, monkeypatch
):
    from fpl_integrations.skill_files import reconcile_skill_files

    data = zip_bytes()
    value = batch([skill_part(data), tool()])
    sessions = installation.db.sessions

    def failed_sessions(**kwargs):
        session = sessions(**kwargs)

        async def failed_commit():
            raise RuntimeError("synthetic commit uncertainty")

        session.commit = failed_commit
        return session

    monkeypatch.setattr(installation.db, "sessions", failed_sessions)
    with pytest.raises(RuntimeError, match="commit uncertainty"):
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    monkeypatch.setattr(installation.db, "sessions", sessions)
    root = installation.settings.runtime_path / "accounts/alpha/integrations/skills"
    assert len(list(root.rglob("SKILL.md"))) == 1
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        session.add(
            ToolApiIntegration(
                id=str(uuid4()),
                owner_user_id="alpha",
                name="My Tool",
                description="",
                method="GET",
                url="https://example.test/occupied",
                auth_kind="none",
                enabled=False,
            )
        )
        await session.commit()
    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {"skill-release": Incoming(data)}, granted(value))
    assert error.value.detail["code"] == "creative_install_name_conflict"
    assert await installation.use.receipt(value, granted(value, "receipt")) is None
    # Startup reconciliation uses only the definitive target database state.
    await reconcile_skill_files(installation.db, installation.settings)
    assert not list(root.rglob("SKILL.md"))


@pytest.mark.asyncio
async def test_private_http_fails_closed_and_binds_verified_batch(installation):
    import httpx
    from fastapi import FastAPI

    from fpl_integrations.creative_http import CreativeRequestLimit, router

    app = FastAPI()
    app.include_router(router)
    app.add_middleware(CreativeRequestLimit, maximum=1024 * 1024)
    app.state.creative_installations = installation.use
    transport = httpx.ASGITransport(app=app)
    value = batch([tool(), skill_part(zip_bytes())])
    path = "/_internal/v1/creative-integrations/"
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        blocked = await client.post(path + "preview", json=value.model_dump(mode="json"))
        assert blocked.status_code == 503

        class TestAuthority:
            async def grant(self, *, request, purpose, operation_id, fingerprint):
                assert request.url.path in {path + "preview", path + "install", path + "receipt"}
                assert isinstance(operation_id, str) and isinstance(fingerprint, str)
                return CreativeOperationGrant(
                    "alpha",
                    purpose,
                    value.operation_id,
                    digest(value.model_dump(mode="json")),
                    int(time.time()) + 5,
                )

        app.state.creative_authorization = TestAuthority()
        result = await client.post(path + "preview", json=value.model_dump(mode="json"))
        assert result.status_code == 200 and result.json()["installable"]
        data = zip_bytes()
        result = await client.post(
            path + "install",
            data={"batch": value.model_dump_json()},
            files={"skill-release": ("archive.zip", data, "application/zip")},
        )
        assert result.status_code == 200, result.text
        receipt = await client.post(path + "receipt", json=value.model_dump(mode="json"))
        assert receipt.json() == result.json()
        corrupted = batch([tool(), skill_part(data)], "another-operation")
        denied = await client.post(
            path + "install",
            data={"batch": corrupted.model_dump_json()},
            files={"other-release": ("archive.zip", data, "application/zip")},
        )
        # A valid grant for a different batch cannot authorize this request.
        assert denied.status_code == 403

        class OtherAccount(TestAuthority):
            async def grant(self, **kwargs):
                return replace(await super().grant(**kwargs), owner_user_id="beta")

        app.state.creative_authorization = OtherAccount()
        missing = await client.post(path + "receipt", json=value.model_dump(mode="json"))
        assert missing.status_code == 404
        oversized = await client.post(path + "preview", content=b"x" * (1024 * 1024 + 1))
        assert oversized.status_code == 413


@pytest.mark.asyncio
async def test_private_stdio_validation_never_echoes_environment(installation):
    import httpx
    from fastapi import FastAPI

    from fpl_integrations.creative_http import router

    app = FastAPI()
    app.include_router(router)
    app.state.creative_installations = installation.use
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post(
            "/_internal/v1/creative-integrations/stdio",
            json={"release_id": "r", "command": "", "environment": {"TOKEN": "private-value"}},
        )
    assert response.status_code == 422
    assert "private-value" not in response.text


async def test_legacy_skill_receipt_replays_without_enabling_a_new_legacy_install(installation):
    data = zip_bytes()
    modern = batch([skill_part(data)])
    result = await installation.use.install(
        modern, {"skill-release": Incoming(data)}, granted(modern)
    )
    legacy = modern.model_copy(deep=True)
    legacy.parts[0].skill.tree_sha256 = None
    assert "tree_sha256" not in legacy.model_dump(mode="json")["parts"][0]["skill"]
    async with installation.db.sessions(info={"owner_user_id": "alpha"}) as session:
        row = await session.scalar(
            select(CreativeInstallReceipt).where(
                CreativeInstallReceipt.operation_id == legacy.operation_id
            )
        )
        row.fingerprint = digest(legacy.model_dump(mode="json"))
        await session.commit()
    assert await installation.use.install(legacy, {}, granted(legacy)) == result
    fresh = batch([legacy.parts[0]], "fresh-legacy")
    with pytest.raises(HTTPException):
        await installation.use.install(
            fresh, {"skill-release": Incoming(data)}, granted(fresh, owner="beta")
        )


async def test_receipt_grant_cannot_authorize_installation(installation):
    value = batch([tool()])
    with pytest.raises(HTTPException) as error:
        await installation.use.install(value, {}, granted(value, "receipt"))
    assert error.value.status_code == 403
    assert await installation.use.receipt(value, granted(value, "receipt")) is None


async def test_creative_source_grant_controls_real_target_and_receipt_recovery(
    installation, tmp_path
):
    import jwt
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from app.console.creative_workshop.models import CreativeItem, CreativeRelease
    from app.console.creative_workshop.schemas import CreativeInstallPreviewIn
    from fpl_creative.install_authorization import (
        IdentityInstallAuthorization,
        InstallAuthorizationDenied,
        InstallSource,
    )
    from fpl_creative.install_grants import InstallGrantAuthority
    from fpl_creative.installation_outbox import InstallationOutbox
    from fpl_creative.migrations.registry import MIGRATIONS as CREATIVE_MIGRATIONS
    from fpl_creative.storage import creative_database
    from fpl_runtime.claims import Actor, issue_context
    from fpl_runtime.creative_install_evidence import INSTALL_PATH, issue_install_evidence

    class Live:
        async def status(self, **_kwargs):
            return True

    root = tmp_path / "creative"
    root.mkdir()
    apply(root / "service.db", "creative", CREATIVE_MIGRATIONS)
    db = creative_database(root)
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "alpha", "user", "session", ("studio:write", "studio:private_read"), session_id="s"
    )
    token = issue_context(
        actor, service="creative", method="POST", path=INSTALL_PATH, private_key=key, key_id="test"
    )
    claims = jwt.decode(
        token, key.public_key(), algorithms=["EdDSA"], issuer="fpl-identity", audience="creative"
    )
    raw = b'{"release_id":"tool-release","names":{"tool-release":"My Tool"}}'
    evidence = issue_install_evidence(
        actor=actor,
        request_id=claims["jti"],
        raw=raw,
        source_expiry=claims["exp"],
        private_key=key,
        key_id="test",
    )
    source = InstallSource(token, evidence, raw)
    request = CreativeInstallPreviewIn.model_validate_json(raw)
    part = tool()
    value = CreativeInstallBatch(
        operation_id=str(uuid5(NAMESPACE_URL, "source-grant")),
        root_release_id="tool-release",
        parts=[part],
    )
    try:
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            session.add(
                CreativeItem(
                    id="item",
                    origin_owner_user_id="author",
                    author_user_id="author",
                    kind="tool_api",
                    status="published",
                )
            )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="tool-release",
                    item_id="item",
                    version=1,
                    title=part.title,
                    summary=part.summary,
                    tags=part.tags,
                    manifest=part.manifest,
                )
            )
            await session.commit()
        outbox = InstallationOutbox(db)
        await outbox.accept("alpha", request, value)
        authority = InstallGrantAuthority(
            outbox, IdentityInstallAuthorization(public_key=key.public_key(), identity=Live())
        )
        installed = await installation.use.install(
            value, {}, lambda: authority.authorize("install", source, value)
        )
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            (await session.get(CreativeItem, "item")).status = "withdrawn"
            await session.commit()
        assert (
            await installation.use.receipt(
                value, lambda: authority.authorize("receipt", source, value)
            )
            == installed
        )
        with pytest.raises(InstallAuthorizationDenied):
            await installation.use.install(
                value, {}, lambda: authority.authorize("install", source, value)
            )
        with pytest.raises(HTTPException) as wrong:
            await installation.use.install(
                value, {}, lambda: authority.authorize("receipt", source, value)
            )
        assert wrong.value.status_code == 403
    finally:
        await db.close()
