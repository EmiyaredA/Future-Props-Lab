"""Installation attempts keep their original batch across retries and restarts."""

import asyncio
from uuid import uuid4

import pytest

from creative_test_support import isolated_resources
from studio.apps.creative_workshop.installation_outbox import (
    InstallationOutbox,
    InstallIntentConflict,
)
from studio.apps.creative_workshop.storage.file_paths import creative_database
from studio.apps.creative_workshop.storage.migrations.registry import MIGRATIONS
from studio.contracts.creative_workshop.catalog import CreativeInstallPreviewIn
from studio.contracts.creative_workshop.creative_integrations import (
    CreativeInstallBatch,
    CreativeInstallPart,
)
from studio.contracts.integrations.integration_intents import digest
from studio.runtime.database.migrations import apply


def batch(name="Tool"):
    return CreativeInstallBatch(
        operation_id=str(uuid4()),
        root_release_id="release",
        parts=[
            CreativeInstallPart(
                release_id="release",
                kind="tool_api",
                title="Tool",
                target_name=name,
                summary="",
                manifest={"method": "GET", "url": "https://example.org"},
            )
        ],
    )


async def seed_release(database):
    from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease

    async with database.sessions(info={"owner_user_id": "author"}) as session:
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
                id="release",
                item_id="item",
                version=1,
                title="Tool",
                manifest={"method": "GET", "url": "https://example.org"},
            )
        )
        await session.commit()


async def test_retry_reuses_batch_after_restart_and_rejects_changes(tmp_path):
    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    await seed_release(database)
    request = CreativeInstallPreviewIn(release_id="release", names={})
    first = batch()
    try:
        accepted = await InstallationOutbox(database).accept("alice", request, first)
        assert accepted.fingerprint == digest(first.model_dump(mode="json"))
        assert accepted.state == "pending"
    finally:
        await database.close()
    database = creative_database(tmp_path)
    try:
        outbox = InstallationOutbox(database)
        retried = await outbox.accept("alice", request, batch())
        assert retried.batch == first
        assert (await outbox.get("alice", "release")) == retried
        assert await outbox.get("bob", "release") is None
        with pytest.raises(InstallIntentConflict):
            await outbox.accept("alice", request, batch("Changed"))
        changed = CreativeInstallPreviewIn(release_id="release", names={"release": "Tool"})
        with pytest.raises(InstallIntentConflict):
            await outbox.accept("alice", changed, batch())
        assert (
            await outbox.accept("bob", request, batch())
        ).batch.operation_id != first.operation_id
    finally:
        await database.close()


async def test_concurrent_acceptance_uses_one_uuid_and_refuses_mismatched_root(tmp_path):
    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        request = CreativeInstallPreviewIn(release_id="release")
        results = await asyncio.gather(
            *(outbox.accept("alice", request, batch()) for _ in range(4))
        )
        assert len({result.batch.operation_id for result in results}) == 1
        with pytest.raises(ValueError, match="不匹配"):
            await outbox.accept("alice", CreativeInstallPreviewIn(release_id="other"), batch())
    finally:
        await database.close()


async def test_receipt_settlement_is_atomic_and_replayable(tmp_path):
    from sqlalchemy import select

    from studio.apps.creative_workshop.storage.models import CreativeInstallation

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        current = await outbox.accept(
            "alice", CreativeInstallPreviewIn(release_id="release"), batch()
        )
        resource = {
            "release_id": "release",
            "kind": "tool_api",
            "name": "Tool",
            "resource_id": "integration",
            "state": "disabled",
        }
        receipt = {
            "operation_id": current.batch.operation_id,
            "root_release_id": "release",
            "resources": [resource],
        }
        with pytest.raises(InstallIntentConflict):
            await outbox.complete("alice", "release", {**receipt, "operation_id": str(uuid4())})
        assert (await outbox.get("alice", "release")).state == "pending"
        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            assert await session.scalar(select(CreativeInstallation)) is None
        result = await outbox.complete("alice", "release", receipt)
        assert result.resources == [resource]
        assert (await outbox.get("alice", "release")).state == "completed"
        assert (await outbox.complete("alice", "release", receipt)).id == result.id
        altered = {**receipt, "resources": [{**resource, "resource_id": "other"}]}
        with pytest.raises(InstallIntentConflict):
            await outbox.complete("alice", "release", altered)
        with pytest.raises(InstallIntentConflict):
            await outbox.complete("bob", "release", receipt)
    finally:
        await database.close()


async def test_lost_source_commit_ack_does_not_create_another_operation(tmp_path):
    from sqlalchemy import event

    from studio.apps.creative_workshop.storage.file_paths import CreativeSession

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    await seed_release(database)
    outbox = InstallationOutbox(database)
    request = CreativeInstallPreviewIn(release_id="release")
    original = batch()
    armed = True

    def lose_ack(_session):
        nonlocal armed
        if armed:
            armed = False
            raise RuntimeError("simulated lost acknowledgement")

    event.listen(CreativeSession, "after_commit", lose_ack)
    try:
        with pytest.raises(RuntimeError, match="lost acknowledgement"):
            await outbox.accept("alice", request, original)
        assert (await outbox.accept("alice", request, batch())).batch == original
    finally:
        event.remove(CreativeSession, "after_commit", lose_ack)
        await database.close()


async def test_first_acceptance_rejects_forged_or_withdrawn_release(tmp_path):
    from sqlalchemy import update

    from studio.apps.creative_workshop.storage.models import CreativeItem

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        request = CreativeInstallPreviewIn(release_id="release")
        forged = batch().model_copy(deep=True)
        forged.parts[0].manifest = {"url": "https://attacker.example"}
        with pytest.raises(InstallIntentConflict):
            await outbox.accept("alice", request, forged)
        assert await outbox.get("alice", "release") is None
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
            )
            await session.commit()
        with pytest.raises(InstallIntentConflict):
            await outbox.accept("alice", request, batch())
        assert await outbox.get("alice", "release") is None
    finally:
        await database.close()


async def test_bundle_settlement_recovers_component_records_together(tmp_path):
    from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            session.add(
                CreativeItem(
                    id="bundle-item",
                    origin_owner_user_id="author",
                    author_user_id="author",
                    kind="bundle",
                    status="published",
                )
            )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="bundle",
                    item_id="bundle-item",
                    version=1,
                    title="Bundle",
                    components=["release"],
                )
            )
            await session.commit()
        outbox = InstallationOutbox(database)
        proposed = batch().model_copy(update={"root_release_id": "bundle"})
        current = await outbox.accept(
            "alice", CreativeInstallPreviewIn(release_id="bundle"), proposed
        )
        resource = {
            "release_id": "release",
            "kind": "tool_api",
            "name": "Tool",
            "resource_id": "integration",
            "state": "disabled",
        }
        receipt = {
            "operation_id": current.batch.operation_id,
            "root_release_id": "bundle",
            "resources": [resource],
        }
        installed = await outbox.complete("alice", "bundle", receipt)
        assert installed.resources == [resource]
        from sqlalchemy import select

        from studio.apps.creative_workshop.storage.models import CreativeInstallation

        async with database.sessions(info={"owner_user_id": "alice"}) as session:
            records = list(await session.scalars(select(CreativeInstallation)))
            assert {row.release_id for row in records} == {"bundle", "release"}
            assert all(row.resources == [resource] for row in records)
        assert (await outbox.complete("alice", "bundle", receipt)).id == installed.id
    finally:
        await database.close()


async def test_coordinator_recovers_lost_target_response_without_resubmission(tmp_path):
    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator

    class Authorization:
        async def require(self, _source_authorization, request):
            assert request.release_id == "release"
            return "alice"

    class Target:
        stored = None
        calls = 0
        lookups = 0

        async def receipt(self, _source_authorization, _batch):
            self.lookups += 1
            return self.stored

        async def install(self, _source_authorization, batch):
            self.calls += 1
            self.stored = {
                "operation_id": batch.operation_id,
                "root_release_id": batch.root_release_id,
                "resources": [
                    {
                        "release_id": "release",
                        "kind": "tool_api",
                        "name": "Tool",
                        "resource_id": "integration",
                        "state": "disabled",
                    }
                ],
            }
            raise TimeoutError("target response lost")

        async def verify_receipt(self, _source_authorization, _batch, response):
            return response

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        target = Target()
        coordinator = InstallationCoordinator(outbox, Authorization(), target)
        request = CreativeInstallPreviewIn(release_id="release")
        first = batch()
        with pytest.raises(TimeoutError):
            await coordinator.install(object(), request, first)
        assert target.lookups == 0
        assert (await outbox.get("alice", "release")).state == "pending"
        from sqlalchemy import update

        from studio.apps.creative_workshop.storage.models import CreativeItem

        async with database.sessions(info={"owner_user_id": "author"}) as session:
            await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
            )
            await session.commit()
        result = await coordinator.resume(object(), request)
        assert result.resources[0]["resource_id"] == "integration"
        assert (await outbox.get("alice", "release")).batch == first
        assert target.calls == 1
        assert target.lookups == 1
    finally:
        await database.close()


async def test_coordinator_fails_closed_on_authorization_and_receipt_faults(tmp_path):
    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator

    class Authorization:
        valid = True

        async def require(self, _source_authorization, _request):
            if not self.valid:
                raise PermissionError("revoked")
            return "alice"

    class Target:
        install_called = False

        async def receipt(self, _source_authorization, _batch):
            raise TimeoutError("receipt unavailable")

        async def install(self, _source_authorization, _batch):
            self.install_called = True
            raise AssertionError("lookup failure cannot imply an absent receipt")

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        auth, target = Authorization(), Target()
        coordinator = InstallationCoordinator(outbox, auth, target)
        request = CreativeInstallPreviewIn(release_id="release")
        auth.valid = False
        with pytest.raises(PermissionError):
            await coordinator.install(object(), request, batch())
        assert await outbox.get("alice", "release") is None
        auth.valid = True
        await outbox.accept("alice", request, batch())
        with pytest.raises(TimeoutError):
            await coordinator.install(object(), request, batch())
        assert not target.install_called
        assert (await outbox.get("alice", "release")).state == "pending"
    finally:
        await database.close()


async def test_coordinator_never_settles_unverified_receipt_or_revoked_actor(tmp_path):
    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator

    class Authorization:
        calls = 0
        revoke = False

        async def require(self, source, _request):
            assert source is marker
            self.calls += 1
            if self.revoke and self.calls > 1:
                raise PermissionError("revoked")
            return "alice"

    class Target:
        verify = False

        async def receipt(self, source, _batch):
            assert source is marker
            return {"untrusted": True}

        install = receipt

        async def verify_receipt(self, source, selected, _response):
            assert source is marker
            if not self.verify:
                raise PermissionError("target receipt unverified")
            return {
                "operation_id": selected.operation_id,
                "root_release_id": selected.root_release_id,
                "resources": [
                    {
                        "release_id": "release",
                        "kind": "tool_api",
                        "name": "Tool",
                        "resource_id": "integration",
                        "state": "disabled",
                    }
                ],
            }

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    marker = object()
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        auth, target = Authorization(), Target()
        coordinator = InstallationCoordinator(outbox, auth, target)
        request = CreativeInstallPreviewIn(release_id="release")
        with pytest.raises(PermissionError, match="unverified"):
            await coordinator.install(marker, request, batch())
        assert (await outbox.get("alice", "release")).state == "pending"
        auth.calls, auth.revoke, target.verify = 0, True, True
        with pytest.raises(PermissionError, match="revoked"):
            await coordinator.install(marker, request, batch())
        assert (await outbox.get("alice", "release")).state == "pending"
    finally:
        await database.close()


async def test_withdrawal_prevents_first_target_install_after_acceptance(tmp_path):
    from sqlalchemy import update

    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator
    from studio.apps.creative_workshop.storage.models import CreativeItem

    class Authorization:
        async def require(self, _source, _request):
            return "alice"

    class Target:
        called = False

        async def receipt(self, _source, _batch):
            return None

        async def install(self, _source, _batch):
            self.called = True
            raise AssertionError("withdrawn release cannot be newly installed")

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        request = CreativeInstallPreviewIn(release_id="release")
        await outbox.accept("alice", request, batch())
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
            )
            await session.commit()
        target = Target()
        with pytest.raises(InstallIntentConflict):
            await InstallationCoordinator(outbox, Authorization(), target).resume(object(), request)
        assert not target.called
        assert (await outbox.get("alice", "release")).state == "pending"
    finally:
        await database.close()


async def test_skill_batch_is_bound_to_the_published_release_tree(tmp_path):
    from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease
    from studio.contracts.creative_workshop.creative_integrations import CreativeSkillBlob
    from studio.runtime.files.skill_tree import skill_tree_sha256

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    directory = tmp_path / "accounts/author/creative-workshop/skill-releases/release"
    directory.mkdir(parents=True)
    (directory / "SKILL.md").write_text("published contents")
    tree = skill_tree_sha256(directory, max_files=10, max_bytes=1024)
    manifest = {"name": "sample", "file_count": 1, "expanded_bytes": 18}
    part = CreativeInstallPart(
        release_id="release",
        kind="skill",
        title="Skill",
        target_name="Skill",
        summary="",
        manifest=manifest,
        skill=CreativeSkillBlob(
            sha256="a" * 64, tree_sha256=tree, byte_size=32, file_count=1, expanded_bytes=18
        ),
    )
    value = CreativeInstallBatch(operation_id=str(uuid4()), root_release_id="release", parts=[part])
    request = CreativeInstallPreviewIn(release_id="release")
    try:
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            session.add(
                CreativeItem(
                    id="item",
                    origin_owner_user_id="author",
                    author_user_id="author",
                    kind="skill",
                    status="published",
                )
            )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="release",
                    item_id="item",
                    version=1,
                    title="Skill",
                    manifest=manifest,
                    skill_path="creative-workshop/skill-releases/release",
                )
            )
            await session.commit()
        with pytest.raises(InstallIntentConflict, match="尚未配置"):
            await InstallationOutbox(database).accept("alice", request, value)
        legacy = value.model_copy(deep=True)
        legacy.parts[0].skill.tree_sha256 = None
        assert "tree_sha256" not in legacy.model_dump(mode="json")["parts"][0]["skill"]
        with pytest.raises(InstallIntentConflict, match="不匹配"):
            await InstallationOutbox(database, skill_root=tmp_path).accept("alice", request, legacy)
        forged = value.model_copy(deep=True)
        forged.parts[0].skill.tree_sha256 = "f" * 64
        outbox = InstallationOutbox(database, skill_root=tmp_path)
        with pytest.raises(InstallIntentConflict, match="不匹配"):
            await outbox.accept("alice", request, forged)
        accepted = await outbox.accept("alice", request, value)
        assert accepted.batch == value
        await outbox.require_current("alice", request, value)
        (directory / "SKILL.md").write_text("modified contents!")
        with pytest.raises(InstallIntentConflict, match="不匹配"):
            await outbox.require_current("alice", request, value)
        # Recovery retains the original intent even if the source is no longer available.
        assert (await outbox.accept("alice", request, value)).batch == value
    finally:
        await database.close()


async def test_install_grant_binds_persisted_batch_and_rechecks_current_publication(tmp_path):
    import jwt
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    from studio.apps.creative_workshop.install_authorization import (
        IdentityInstallAuthorization,
        InstallAuthorizationDenied,
        InstallSource,
    )
    from studio.apps.creative_workshop.install_grants import InstallGrantAuthority
    from studio.apps.creative_workshop.storage.models import CreativeItem
    from studio.contracts.creative_workshop.creative_install_evidence import (
        INSTALL_PATH,
        issue_install_evidence,
    )
    from studio.contracts.identity.claims import Actor, issue_context

    class Live:
        active = True

        async def status(self, **_kwargs):
            return self.active

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    key = Ed25519PrivateKey.generate()
    actor = Actor(
        "alice", "user", "session", ("studio:write", "studio:private_read"), session_id="s"
    )
    source_token = issue_context(
        actor, service="creative", method="POST", path=INSTALL_PATH, private_key=key, key_id="test"
    )
    claims = jwt.decode(
        source_token,
        key.public_key(),
        algorithms=["EdDSA"],
        issuer="fpl-identity",
        audience="creative",
    )
    raw = b'{"release_id":"release","names":{}}'
    evidence = issue_install_evidence(
        actor=actor,
        request_id=claims["jti"],
        raw=raw,
        source_expiry=claims["exp"],
        private_key=key,
        key_id="test",
    )
    source = InstallSource(source_token, evidence, raw)
    request = CreativeInstallPreviewIn.model_validate_json(raw)
    value = batch()
    live = Live()
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        authority = InstallGrantAuthority(
            outbox, IdentityInstallAuthorization(public_key=key.public_key(), identity=live)
        )
        with pytest.raises(InstallAuthorizationDenied):
            await authority.authorize("install", source, value)
        await outbox.accept("alice", request, value)
        decision = await authority.authorize("install", source, value)
        cancel_grant = await authority.authorize("cancel", source, value)
        assert cancel_grant.purpose == "cancel"
        assert decision.owner_user_id == "alice" and decision.fingerprint == digest(
            value.model_dump(mode="json")
        )
        modified = value.model_copy(deep=True)
        modified.parts[0].target_name = "forged"
        with pytest.raises(InstallAuthorizationDenied):
            await authority.authorize("install", source, modified)
        from studio.runtime.database.sessions import ServiceStorageError

        async with database.sessions(info={"owner_user_id": "author"}) as session:
            item = await session.get(CreativeItem, "item")
            item.status = "withdrawn"
            with pytest.raises(ServiceStorageError, match="安装结果未确认"):
                await session.commit()
            await session.rollback()
        receipt = {
            "operation_id": value.operation_id,
            "root_release_id": "release",
            "resources": [
                {
                    "release_id": "release",
                    "kind": "tool_api",
                    "name": "Tool",
                    "resource_id": "tool",
                    "state": "disabled",
                }
            ],
        }
        await outbox.complete("alice", "release", receipt)
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            item = await session.get(CreativeItem, "item")
            item.status = "withdrawn"
            await session.commit()
        with pytest.raises(InstallAuthorizationDenied):
            await authority.authorize("install", source, value)
        receipt_grant = await authority.authorize("receipt", source, value)
        assert receipt_grant.operation_id == value.operation_id
        assert receipt_grant.purpose == "receipt"
        live.active = False
        with pytest.raises(InstallAuthorizationDenied):
            await authority.authorize("receipt", source, value)
    finally:
        await database.close()


async def test_fences_survive_restart_and_release_only_with_valid_receipt(tmp_path):
    from sqlalchemy import select, update

    from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence
    from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    await seed_release(database)
    request = CreativeInstallPreviewIn(release_id="release")
    value = batch()
    outbox = InstallationOutbox(database)
    await outbox.accept("alice", request, value)
    await outbox.fence_for_install("alice", request, value)
    await outbox.fence_for_install("alice", request, value)
    await database.close()
    database = creative_database(tmp_path)
    try:
        outbox = InstallationOutbox(database)
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            fences = list(await session.scalars(select(CreativeInstallFence)))
            assert [(f.operation_id, f.item_id) for f in fences] == [(value.operation_id, "item")]
            blocked = await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
            )
            assert blocked.rowcount == 0
            for field, replacement in (("kind", "skill"), ("current_release_id", "other")):
                changed = await session.execute(
                    update(CreativeItem)
                    .where(CreativeItem.id == "item")
                    .values({field: replacement})
                )
                assert changed.rowcount == 0
            blocked_release = await session.execute(
                update(CreativeRelease)
                .where(CreativeRelease.id == "release")
                .values(title="Changed")
            )
            assert blocked_release.rowcount == 0
            await session.rollback()
        with pytest.raises(InstallIntentConflict):
            await outbox.complete("alice", "release", {"operation_id": "wrong"})
        with pytest.raises(InstallIntentConflict):
            await outbox.fence_for_install("bob", request, value)
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            assert len(list(await session.scalars(select(CreativeInstallFence)))) == 1
        receipt = {
            "operation_id": value.operation_id,
            "root_release_id": "release",
            "resources": [
                {
                    "release_id": "release",
                    "kind": "tool_api",
                    "name": "Tool",
                    "resource_id": "tool",
                    "state": "disabled",
                }
            ],
        }
        await outbox.complete("alice", "release", receipt)
        async with database.sessions(info={"owner_user_id": "author"}) as session:
            assert list(await session.scalars(select(CreativeInstallFence))) == []
            changed = await session.execute(
                update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
            )
            assert changed.rowcount == 1
            await session.commit()
        assert (await outbox.complete("alice", "release", receipt)).release_id == "release"
    finally:
        await database.close()


async def test_withdraw_and_fence_reservation_cannot_both_win(tmp_path):
    from sqlalchemy import update

    from studio.apps.creative_workshop.storage.models import CreativeItem

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    database = creative_database(tmp_path)
    try:
        await seed_release(database)
        outbox = InstallationOutbox(database)
        request, value = CreativeInstallPreviewIn(release_id="release"), batch()
        await outbox.accept("alice", request, value)

        async def reserve():
            try:
                await outbox.fence_for_install("alice", request, value)
                return True
            except InstallIntentConflict:
                return False

        async def withdraw():
            async with database.sessions(info={"owner_user_id": "author"}) as session:
                changed = await session.execute(
                    update(CreativeItem).where(CreativeItem.id == "item").values(status="withdrawn")
                )
                await session.commit()
                return changed.rowcount == 1

        fenced, withdrawn = await asyncio.gather(reserve(), withdraw())
        assert fenced != withdrawn
    finally:
        await database.close()


async def test_bundle_fences_root_and_every_component_until_settlement(tmp_path):
    from sqlalchemy import select, update

    from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence
    from studio.apps.creative_workshop.storage.models import CreativeItem, CreativeRelease

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    try:
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            for item_id, kind in (
                ("bundle", "bundle"),
                ("item-a", "tool_api"),
                ("item-b", "tool_api"),
            ):
                session.add(
                    CreativeItem(
                        id=item_id,
                        origin_owner_user_id="author",
                        author_user_id="author",
                        kind=kind,
                        status="published",
                    )
                )
            await session.flush()
            session.add(
                CreativeRelease(
                    id="root", item_id="bundle", version=1, title="Bundle", components=["a", "b"]
                )
            )
            for release_id, item_id in (("a", "item-a"), ("b", "item-b")):
                session.add(
                    CreativeRelease(
                        id=release_id,
                        item_id=item_id,
                        version=1,
                        title=release_id,
                        manifest={"method": "GET", "url": "https://example.test"},
                    )
                )
            await session.commit()
        parts = [
            CreativeInstallPart(
                release_id=release_id,
                kind="tool_api",
                title=release_id,
                target_name=release_id,
                summary="",
                manifest={"method": "GET", "url": "https://example.test"},
            )
            for release_id in ("a", "b")
        ]
        value = CreativeInstallBatch(operation_id=str(uuid4()), root_release_id="root", parts=parts)
        request = CreativeInstallPreviewIn(release_id="root")
        outbox = InstallationOutbox(db)
        await outbox.accept("alice", request, value)
        await outbox.fence_for_install("alice", request, value)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            assert set(await session.scalars(select(CreativeInstallFence.item_id))) == {
                "bundle",
                "item-a",
                "item-b",
            }
            changed = await session.execute(
                update(CreativeItem)
                .where(CreativeItem.id.in_(["bundle", "item-a", "item-b"]))
                .values(status="withdrawn")
            )
            assert changed.rowcount == 0
            await session.rollback()
        receipt = {
            "operation_id": value.operation_id,
            "root_release_id": "root",
            "resources": [
                {
                    "release_id": part.release_id,
                    "kind": "tool_api",
                    "name": part.title,
                    "resource_id": "resource-" + part.release_id,
                    "state": "disabled",
                }
                for part in parts
            ],
        }
        await outbox.complete("alice", "root", receipt)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            changed = await session.execute(
                update(CreativeItem)
                .where(CreativeItem.id.in_(["bundle", "item-a", "item-b"]))
                .values(status="withdrawn")
            )
            assert changed.rowcount == 3
            await session.commit()
    finally:
        await db.close()


async def test_catalog_withdraw_is_blocked_by_fence_until_receipt(tmp_path):
    from studio.apps.creative_workshop.catalog import CreativeCatalog
    from studio.contracts.creative_workshop.errors import CreativeError
    from studio.contracts.identity.principal import StudioPrincipal

    class Authors:
        async def name(self, **_kwargs):
            return "Author"

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    request, value = CreativeInstallPreviewIn(release_id="release"), batch()
    principal = StudioPrincipal(
        platform_role="user",
        user_id="author",
        must_change_password=False,
        auth_kind="session",
        scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
    )
    try:
        await seed_release(db)
        outbox = InstallationOutbox(db)
        await outbox.accept("alice", request, value)
        await outbox.fence_for_install("alice", request, value)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            with pytest.raises(CreativeError) as error:
                await CreativeCatalog(
                    session, principal, resources=isolated_resources(tmp_path, Authors())
                ).withdraw("item", 0)
            assert error.value.status == 409
        receipt = {
            "operation_id": value.operation_id,
            "root_release_id": "release",
            "resources": [
                {
                    "release_id": "release",
                    "kind": "tool_api",
                    "name": "Tool",
                    "resource_id": "tool",
                    "state": "disabled",
                }
            ],
        }
        await outbox.complete("alice", "release", receipt)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            result = await CreativeCatalog(
                session, principal, resources=isolated_resources(tmp_path, Authors())
            ).withdraw("item", 0)
            assert result.status == "withdrawn" and result.revision == 1
    finally:
        await db.close()


async def test_cancel_coordinator_keeps_fence_until_authenticated_target_result(tmp_path):
    from sqlalchemy import select

    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator
    from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence

    class Authorization:
        async def require(self, _source, _request):
            return "alice"

    class Target:
        calls = 0

        async def cancel(self, _source, selected):
            self.calls += 1
            proof = {
                "state": "cancelled",
                "operation_id": selected.operation_id,
                "fingerprint": digest(selected.model_dump(mode="json")),
            }
            if self.calls == 1:
                raise TimeoutError("target response lost")
            return proof

        async def verify_cancellation(self, _source, _batch, response):
            return response

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    request, value = CreativeInstallPreviewIn(release_id="release"), batch()
    try:
        await seed_release(db)
        outbox = InstallationOutbox(db)
        await outbox.accept("alice", request, value)
        await outbox.fence_for_install("alice", request, value)
        target = Target()
        coordinator = InstallationCoordinator(outbox, Authorization(), target)
        with pytest.raises(TimeoutError):
            await coordinator.cancel(object(), request)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            assert list(await session.scalars(select(CreativeInstallFence)))
        assert (await outbox.get("alice", "release")).state == "pending"
        assert await coordinator.cancel(object(), request) == {"state": "cancelled"}
        assert await coordinator.cancel(object(), request) == {"state": "cancelled"}
        assert target.calls == 2
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            assert list(await session.scalars(select(CreativeInstallFence))) == []
    finally:
        await db.close()


async def test_cancel_coordinator_settles_when_target_already_committed(tmp_path):
    from studio.apps.creative_workshop.installation_coordinator import InstallationCoordinator

    class Authorization:
        async def require(self, _source, _request):
            return "alice"

    class Target:
        async def cancel(self, _source, selected):
            return {
                "state": "committed",
                "receipt": {
                    "operation_id": selected.operation_id,
                    "root_release_id": "release",
                    "resources": [
                        {
                            "release_id": "release",
                            "kind": "tool_api",
                            "name": "Tool",
                            "resource_id": "tool",
                            "state": "disabled",
                        }
                    ],
                },
            }

        async def verify_cancellation(self, _source, _batch, response):
            return response

        async def verify_receipt(self, _source, _batch, response):
            return response

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    request, value = CreativeInstallPreviewIn(release_id="release"), batch()
    try:
        await seed_release(db)
        outbox = InstallationOutbox(db)
        await outbox.accept("alice", request, value)
        await outbox.fence_for_install("alice", request, value)
        coordinator = InstallationCoordinator(outbox, Authorization(), Target())
        result = await coordinator.cancel(object(), request)
        assert result["state"] == "committed" and result["installation"]["release_id"] == "release"
        assert (await outbox.get("alice", "release")).state == "completed"
        assert await coordinator.cancel(object(), request) == result
    finally:
        await db.close()


async def test_lost_source_cancellation_commit_replays_without_releasing_wrong_fence(
    tmp_path, monkeypatch
):
    from sqlalchemy import select

    from studio.apps.creative_workshop.storage.fence_records import CreativeInstallFence

    apply(tmp_path / "service.db", "creative", MIGRATIONS)
    db = creative_database(tmp_path)
    request, value = CreativeInstallPreviewIn(release_id="release"), batch()
    try:
        await seed_release(db)
        outbox = InstallationOutbox(db)
        intent = await outbox.accept("alice", request, value)
        await outbox.fence_for_install("alice", request, value)
        proof = {
            "state": "cancelled",
            "operation_id": value.operation_id,
            "fingerprint": intent.fingerprint,
        }
        factory = db.sessions

        def lose_commit(**options):
            session = factory(**options)
            original = session.commit

            async def lost():
                await original()
                raise RuntimeError("lost cancellation response")

            session.commit = lost
            return session

        monkeypatch.setattr(db, "sessions", lose_commit)
        with pytest.raises(RuntimeError, match="lost cancellation response"):
            await outbox.cancel("alice", "release", proof)
        monkeypatch.setattr(db, "sessions", factory)
        assert (await outbox.get("alice", "release")).state == "cancelled"
        await outbox.cancel("alice", "release", proof)
        async with db.sessions(info={"owner_user_id": "author"}) as session:
            assert list(await session.scalars(select(CreativeInstallFence))) == []
    finally:
        await db.close()
