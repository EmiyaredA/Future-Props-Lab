"""File operations require no project ORM and never touch production storage."""

from io import BytesIO

import pytest
from PIL import Image
from sqlalchemy import select

from studio.apps.asset_library.deletions import FileCleanup
from studio.apps.asset_library.files import Files
from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.asset_library.settings import StorageSettings
from studio.apps.asset_library.storage.migrations.registry import MIGRATIONS
from studio.apps.asset_library.storage.models import VisualAsset, VisualAssetFolder
from studio.apps.asset_library.storage.service_models import (
    MODELS,
    AssetDeletion,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.files import VisualAssetFolderCreateIn, VisualAssetPatchIn
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.runtime.database.migrations import apply
from studio.runtime.database.sessions import Database
from studio.runtime.revisions import RevisionConflictError


class Upload:
    filename = "fixture.png"
    content_type = "image/png"

    def __init__(self):
        self.data = BytesIO()
        Image.new("RGB", (2, 2), color="red").save(self.data, format="PNG")
        self.data.seek(0)

    async def read(self, size=-1):
        return self.data.read(size)

    async def close(self):
        self.data.close()


@pytest.fixture
async def owned(tmp_path):
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    database = Database("assets", tmp_path, models=MODELS)
    settings = StorageSettings(tmp_path / "service.db")
    calls = []
    await AssetReferences(database).replace(
        owner="alpha",
        service="visual",
        update=ReferenceUpdate(
            request_id="own-canvas",
            resource_kind="canvas",
            resource_id="owned-project",
            resource_revision=0,
            expected_revision=0,
            asset_ids=[],
        ),
    )

    def cases(session, owner="alpha"):
        async def project_exists(project):
            calls.append(project)
            return owner == "alpha" and project == "owned-project"

        session.info["owner_user_id"] = owner
        return Files(session, settings, owner, project_exists=project_exists)

    try:
        yield database, settings, cases, calls
    finally:
        await database.close()


async def test_upload_folder_cas_account_isolation_and_queued_cleanup(owned):
    database, settings, cases, calls = owned
    async with database.sessions() as session:
        folder = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="library",
                name="Owned",
            )
        )
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=folder.id)
    async with database.sessions() as session:
        _, path = await cases(session).content(asset.id)
        assert path.is_file() and path.is_relative_to(database.root / "accounts/alpha")
        with pytest.raises(RevisionConflictError):
            await cases(session).patch_asset(
                asset.id,
                VisualAssetPatchIn(
                    expected_revision=5,
                    display_name="Conflicting",
                ),
            )
    async with database.sessions() as session:
        with pytest.raises(AssetError) as missing:
            await cases(session, "beta").content(asset.id)
        assert missing.value.status == 404
    async with database.sessions() as session:
        await cases(session).delete_folder(folder.id, folder.revision)
    assert path.is_file(), "physical deletion is deferred until after commit"
    # Simulate an app crash after DB commit and before filesystem cleanup.
    reopened = Database("assets", database.root, models=MODELS)
    try:
        cleanup = FileCleanup(reopened, settings)
        assert await cleanup.run_once() == 1
        assert not path.exists()
        assert await cleanup.run_once() == 0
        async with reopened.sessions() as session:
            session.info["owner_user_id"] = "alpha"
            record = await session.scalar(select(AssetDeletion))
            assert record.status == "completed"
            assert await session.get(VisualAsset, asset.id) is None
            assert await session.get(VisualAssetFolder, folder.id) is None
    finally:
        await reopened.close()
    assert calls == []


async def test_referenced_subtree_rejects_delete_atomically(owned):
    database, _settings, cases, _calls = owned
    async with database.sessions() as session:
        parent = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="library",
                name="Parent",
            )
        )
    async with database.sessions() as session:
        child = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="library",
                name="Child",
                parent_id=parent.id,
            )
        )
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=child.id)
    await AssetReferences(database).replace(
        owner="alpha",
        service="thought",
        update=ReferenceUpdate(
            request_id="retain",
            resource_kind="history",
            resource_id="history-id",
            resource_revision=1,
            expected_revision=0,
            asset_ids=[asset.id],
        ),
    )
    async with database.sessions() as session:
        with pytest.raises(AssetError) as blocked:
            await cases(session).delete_folder(parent.id, parent.revision)
        assert blocked.value.code == "asset_in_use"
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert await session.get(VisualAssetFolder, parent.id) is not None
        assert await session.get(VisualAssetFolder, child.id) is not None
        assert await session.get(VisualAsset, asset.id) is not None
        assert await session.scalar(select(AssetDeletion)) is None


async def test_project_validation_is_explicit_and_owned_reference_listing_is_complete(owned):
    database, _settings, cases, calls = owned
    async with database.sessions() as session:
        with pytest.raises(AssetError) as missing:
            await cases(session).create_folder(
                VisualAssetFolderCreateIn(
                    scope="project",
                    project_id="other-project",
                    name="Denied",
                )
            )
        assert missing.value.status == 404
    async with database.sessions() as session:
        folder = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="project",
                project_id="owned-project",
                name="Project files",
            )
        )
    async with database.sessions() as session:
        await cases(session).upload(Upload(), project_id="owned-project", folder_id=folder.id)
    async with database.sessions() as session:
        result = await cases(session).list_assets(
            project_id="owned-project",
            folder_id=folder.id,
            query="",
            media_kind=None,
            sort="name",
            include_references=True,
        )
        assert len(result.items) == 1
        assert result.items[0].project_id == "owned-project"
        assert result.items[0].is_reference is False
    assert calls == ["other-project", "owned-project", "owned-project", "owned-project"]


async def test_cleanup_keeps_failed_job_and_retries_known_idempotent_unlink(owned, monkeypatch):
    database, settings, cases, _calls = owned
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        _, path = await cases(session).content(asset.id)
    async with database.sessions() as session:
        await cases(session).delete_asset(asset.id, asset.revision)
    unlink = type(path).unlink

    def failed(target, *args, **kwargs):
        if target == path:
            raise PermissionError("synthetic denial")
        return unlink(target, *args, **kwargs)

    monkeypatch.setattr(type(path), "unlink", failed)
    assert await FileCleanup(database, settings).run_once() == 0
    assert path.is_file()
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        row = await session.scalar(select(AssetDeletion))
        assert row.status == "queued" and row.error_code == "file_cleanup_failed"
    monkeypatch.setattr(type(path), "unlink", unlink)
    assert await FileCleanup(database, settings).run_once() == 1
    assert not path.exists()


async def test_cleanup_refuses_symlinks_and_preserves_external_original(owned, tmp_path):
    database, settings, cases, _calls = owned
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        _, path = await cases(session).content(asset.id)
    outside = tmp_path / "unique-original.png"
    path.rename(outside)
    path.symlink_to(outside)
    async with database.sessions() as session:
        await cases(session).delete_asset(asset.id, asset.revision)
    assert await FileCleanup(database, settings).run_once() == 0
    assert outside.is_file() and path.is_symlink()


async def test_folder_archive_uses_only_owned_storage_and_preserves_account_boundaries(owned):
    from studio.apps.asset_library.archives.folder_archive import LibraryFolderArchive

    database, settings, cases, _calls = owned
    async with database.sessions() as session:
        folder = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="library",
                name="Exported folder",
            )
        )
    async with database.sessions() as session:
        original = await cases(session).upload(Upload(), project_id=None, folder_id=folder.id)
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        archive = await LibraryFolderArchive(session, settings, "alpha").export_subtree(folder.id)
    incoming = Upload()
    incoming.data.close()
    incoming.data = BytesIO(archive.path.read_bytes())
    incoming.filename = "exported.zip"
    incoming.content_type = "application/zip"
    async with database.sessions() as session:
        session.info["owner_user_id"] = "beta"
        result = await LibraryFolderArchive(session, settings, "beta").import_archive(
            incoming, parent_folder_id=None
        )
        assert result.created_files == 1
    async with database.sessions() as session:
        session.info["owner_user_id"] = "beta"
        imported = list((await session.scalars(select(VisualAsset))).all())
        assert len(imported) == 1 and imported[0].id != original.id
        assert imported[0].owner_user_id == "beta"
        _row, path = await cases(session, "beta").content(imported[0].id)
        assert path.is_relative_to(settings.account_path("beta"))
