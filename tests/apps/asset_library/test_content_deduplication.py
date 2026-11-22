"""Exact originals, owned decisions, retained references and recoverable removals."""

import asyncio
from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select

from studio.apps.asset_library.content_audits import ContentAudits
from studio.apps.asset_library.content_cleanup import ContentCleanup
from studio.apps.asset_library.files import Files
from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.content_models import (
    AssetContentFingerprint,
    AssetDedupeCanonicalPin,
    AssetDedupeOperation,
)
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS
from studio.apps.asset_library.storage.migrations.versions.v0021 import SQL
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import MODELS
from studio.contracts.asset_library.content_identity import ContentAuditRequest, DedupeStep
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.runtime.database.migrations import Migration, apply
from studio.runtime.database.sessions import Database


class Upload:
    filename, content_type = "same-name.png", "image/png"

    def __init__(self, color="red"):
        self.data = BytesIO()
        Image.new("RGB", (3, 3), color=color).save(self.data, format="PNG")
        self.data.seek(0)

    async def read(self, size=-1):
        return self.data.read(size)

    async def close(self):
        self.data.close()


@pytest.fixture
async def content(tmp_path):
    migrations = (
        MIGRATIONS
        if MIGRATIONS[-1].id.startswith("0021")
        else (*MIGRATIONS, Migration("0021_content_identity", SQL))
    )
    apply(tmp_path / "service.db", "assets", migrations)
    models = tuple(
        dict.fromkeys(
            (*MODELS, AssetContentFingerprint, AssetDedupeOperation, AssetDedupeCanonicalPin)
        )
    )
    database = Database("assets", tmp_path, models=models)
    settings = StorageSettings(tmp_path / "service.db")
    for project in ("one", "two"):
        await AssetReferences(database).replace(
            owner="alpha",
            service="visual",
            update=ReferenceUpdate(
                request_id=project,
                resource_kind="canvas",
                resource_id=project,
                resource_revision=0,
                expected_revision=0,
                asset_ids=[],
            ),
        )

    def files(session, owner="alpha"):
        async def exists(project):
            return owner == "alpha" and project in ("one", "two")

        session.info["owner_user_id"] = owner
        return Files(session, settings, owner, project_exists=exists)

    try:
        yield database, files
    finally:
        await database.close()


async def upload(content, project=None, owner="alpha", color="red"):
    database, files = content
    async with database.sessions() as session:
        return await files(session, owner).upload(Upload(color), project_id=project, folder_id=None)


async def audit(content, request="test"):
    database, files = content
    async with database.sessions() as session:
        return await ContentAudits(files(session)).create(
            ContentAuditRequest(request_id=request, project_ids=["one", "two"])
        )


async def action(content, current, method, group=0):
    database, files = content
    async with database.sessions() as session:
        return await getattr(ContentCleanup(ContentAudits(files(session))), method)(
            current.id,
            DedupeStep(
                expected_revision=current.revision,
                content_key=current.groups[group].content_key,
                remove_asset_ids=[member.id for member in current.groups[group].members],
            ),
        )


async def test_exact_identity_ignores_filename_and_rejects_foreign_ids(content):
    a, b, changed = (
        await upload(content, "one"),
        await upload(content),
        await upload(content, "one", color="blue"),
    )
    foreign = await upload(content, owner="beta")
    database, files = content
    async with database.sessions() as session:
        identities = await ContentAudits(files(session)).identities([a.id, b.id, changed.id])
        by_id = {item.asset_id: item for item in identities.items}
        assert by_id[a.id].content_key == by_id[b.id].content_key
        assert set(by_id[a.id].equivalent_ids) == {a.id, b.id}
        assert by_id[changed.id].content_key != by_id[a.id].content_key
        with pytest.raises(AssetError):
            await ContentAudits(files(session)).identities([foreign.id])


async def test_duplicate_cleanup_preserves_canonical_and_restores_same_ids(content):
    a, b, canonical = (
        await upload(content, "one"),
        await upload(content, "two"),
        await upload(content),
    )
    current = await audit(content)
    assert len(current.groups) == 1 and current.groups[0].canonical_id == canonical.id
    assert (await audit(content)).id == current.id
    current = await action(content, current, "prepare")
    current = await action(content, current, "clean")
    assert set(current.groups[0].removed_ids) == {a.id, b.id}
    assert current.groups[0].reclaimed_bytes == a.byte_size + b.byte_size
    assert (await action(content, current, "clean")).revision == current.revision
    database, files = content
    async with database.sessions() as session:
        with pytest.raises(AssetError):
            await files(session).delete_asset(canonical.id, canonical.revision)
    current = await action(content, current, "restore")
    assert current.groups[0].state == "restored" and current.groups[0].reclaimed_bytes == 0
    assert (await action(content, current, "restore")).revision == current.revision
    async with database.sessions() as session:
        for identity in (a.id, b.id, canonical.id):
            row, path = await files(session).content(identity)
            assert path.is_file() and row.id == identity


async def test_referenced_duplicate_is_skipped_and_other_originals_are_cleaned(content):
    duplicate, canonical = await upload(content, "one"), await upload(content)
    database, files = content
    await AssetReferences(database).replace(
        owner="alpha",
        service="visual",
        update=ReferenceUpdate(
            request_id="pin-history",
            resource_kind="canvas",
            resource_id="one",
            resource_revision=1,
            expected_revision=1,
            asset_ids=[duplicate.id],
        ),
    )
    current = await action(content, await audit(content), "prepare")
    current = await action(content, current, "clean")
    assert current.groups[0].removed_ids == []
    assert current.groups[0].skipped == {duplicate.id: "asset_in_use"}
    async with database.sessions() as session:
        assert (await files(session).content(duplicate.id))[1].is_file()
        assert (await files(session).content(canonical.id))[1].is_file()


async def test_cross_project_group_creates_only_one_shared_original(content):
    a, b = await upload(content, "one"), await upload(content, "two")
    current = await action(content, await audit(content), "prepare")
    shared = current.groups[0].canonical_id
    assert shared not in (a.id, b.id)
    assert (await action(content, current, "prepare")).groups[0].canonical_id == shared
    database, files = content
    async with database.sessions() as session:
        original = await files(session)._asset(shared)
        assert original.project_id is None


async def test_changed_content_stops_cleanup_even_when_cached(content):
    duplicate, _canonical = await upload(content, "one"), await upload(content)
    current = await action(content, await audit(content), "prepare")
    database, files = content
    async with database.sessions() as session:
        _, path = await files(session).content(duplicate.id)
        path.write_bytes(b"changed")
    with pytest.raises(AssetError) as error:
        await action(content, current, "clean")
    assert error.value.code == "dedupe_content_changed"
    async with database.sessions() as session:
        files(session)
        assert await session.scalar(select(VisualAsset.id).where(VisualAsset.id == duplicate.id))


async def test_audit_owner_and_request_scope_cannot_be_replaced(content):
    await upload(content, "one")
    await upload(content)
    current = await audit(content)
    database, files = content
    async with database.sessions() as session:
        with pytest.raises(AssetError):
            await ContentAudits(files(session, "beta")).status(current.id)
        with pytest.raises(AssetError) as error:
            await ContentAudits(files(session)).create(
                ContentAuditRequest(request_id="test", project_ids=["one"])
            )
        assert error.value.code == "dedupe_request_conflict"


async def test_parallel_prepare_reuses_reserved_identity_or_returns_conflict(content):
    await upload(content, "one")
    await upload(content, "two")
    current = await audit(content)
    results = await asyncio.gather(
        action(content, current, "prepare"),
        action(content, current, "prepare"),
        return_exceptions=True,
    )
    assert any(not isinstance(value, Exception) for value in results)
    assert all(
        not isinstance(value, Exception) or isinstance(value, AssetError) for value in results
    )
    database, files = content
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        library = list(
            await session.scalars(select(VisualAsset).where(VisualAsset.project_id.is_(None)))
        )
        assert len(library) == 1


async def test_unselected_duplicates_are_kept(content):
    await upload(content)
    first = await upload(content, "one")
    second = await upload(content, "two")
    current = await action(content, await audit(content), "prepare")
    database, files = content
    async with database.sessions() as session:
        result = await ContentCleanup(ContentAudits(files(session))).clean(current.id, DedupeStep(
            expected_revision=current.revision, content_key=current.groups[0].content_key,
            remove_asset_ids=[first.id],
        ))
    assert result.groups[0].removed_ids == [first.id]
    assert result.groups[0].skipped[second.id] == "not_selected"


async def test_cleanup_after_lost_purge_result_is_replayable(content, monkeypatch):
    await upload(content)
    duplicate = await upload(content, "one")
    current = await action(content, await audit(content), "prepare")
    original = ContentCleanup.purge

    async def interrupted(*_args):
        raise OSError("injected purge interruption")

    monkeypatch.setattr(ContentCleanup, "purge", interrupted)
    with pytest.raises(OSError):
        await action(content, current, "clean")
    monkeypatch.setattr(ContentCleanup, "purge", original)
    result = await action(content, current, "clean")
    assert result.groups[0].removed_ids == [duplicate.id]
    assert result.groups[0].reclaimed_bytes > 0
    restored = await action(content, result, "restore")
    assert restored.groups[0].state == "restored"
