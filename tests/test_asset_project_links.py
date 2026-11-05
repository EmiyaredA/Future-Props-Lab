"""Project file placement is owned by Assets, with no source-project ORM or database."""

import asyncio

import pytest
from sqlalchemy import select
from tests.test_asset_owned_files import Upload
from tests.test_asset_owned_files import owned as owned

from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.schemas.files import (
    VisualAssetFolderCreateIn,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
)
from studio.apps.asset_library.project_links import ProjectFileLinks
from studio.apps.asset_library.storage.service_models import VisualProjectFileLink
from studio.runtime.revisions import RevisionConflictError


async def setup_links(owned):
    database, _settings, cases, _calls = owned
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=None)
    async with database.sessions() as session:
        folder = await cases(session).create_folder(
            VisualAssetFolderCreateIn(
                scope="project",
                project_id="owned-project",
                name="Project folder",
            )
        )
    async with database.sessions() as session:
        link = await ProjectFileLinks(cases(session)).create(
            "owned-project",
            VisualAssetReferenceCreateIn(asset_id=asset.id, folder_id=folder.id),
        )
    return asset, folder, link


async def test_project_folder_deletion_removes_placement_but_preserves_library_original(owned):
    database, _settings, cases, _calls = owned
    asset, folder, link = await setup_links(owned)
    assert link.is_reference and link.id == asset.id
    assert link.reference_id is not None and link.project_id == "owned-project"
    async with database.sessions() as session:
        listed = await cases(session).list_assets(
            project_id="owned-project",
            folder_id=folder.id,
            query="",
            media_kind=None,
            sort="name",
            include_references=True,
        )
        assert [item.reference_id for item in listed.items] == [link.reference_id]
    async with database.sessions() as session:
        with pytest.raises(AssetError) as retained:
            await cases(session).delete_asset(asset.id, asset.revision)
        assert retained.value.code == "asset_in_use"
    async with database.sessions() as session:
        await cases(session).delete_folder(folder.id, folder.revision)
    async with database.sessions() as session:
        row, original = await cases(session).content(asset.id)
        assert row.id == asset.id and original.is_file()
        assert await session.get(VisualProjectFileLink, link.reference_id) is None


async def test_link_rename_move_and_delete_use_cas_and_preserve_file_metadata(owned):
    database, _settings, cases, _calls = owned
    asset, _folder, link = await setup_links(owned)
    async with database.sessions() as session:
        changed = await ProjectFileLinks(cases(session)).patch(
            "owned-project",
            link.reference_id,
            VisualAssetReferencePatchIn(
                expected_revision=link.revision, display_name="Renamed", move_to_root=True
            ),
        )
        assert changed.revision == link.revision + 1
        assert changed.display_name == "Renamed" and changed.folder_id is None
    for action in ("patch", "delete"):
        async with database.sessions() as session:
            links = ProjectFileLinks(cases(session))
            with pytest.raises(RevisionConflictError) as conflict:
                if action == "patch":
                    await links.patch(
                        "owned-project",
                        link.reference_id,
                        VisualAssetReferencePatchIn(
                            expected_revision=link.revision, display_name="Stale"
                        ),
                    )
                else:
                    await links.delete("owned-project", link.reference_id, link.revision)
            assert conflict.value.current == changed.revision
    async with database.sessions() as session:
        original = await cases(session)._asset(asset.id)
        assert original.display_name == asset.display_name and original.revision == asset.revision
    async with database.sessions() as session:
        await ProjectFileLinks(cases(session)).delete(
            "owned-project",
            link.reference_id,
            changed.revision,
        )
    async with database.sessions() as session:
        assert (await cases(session).content(asset.id))[1].is_file()


async def test_link_concurrent_creation_is_idempotent_and_cannot_cross_accounts(owned):
    database, _settings, cases, _calls = owned
    async with database.sessions() as session:
        asset = await cases(session).upload(Upload(), project_id=None, folder_id=None)

    async def create(owner="alpha"):
        async with database.sessions() as session:
            return await ProjectFileLinks(cases(session, owner)).create(
                "owned-project",
                VisualAssetReferenceCreateIn(asset_id=asset.id),
            )

    first, second = await asyncio.gather(create(), create())
    assert first.reference_id == second.reference_id
    with pytest.raises(AssetError) as inaccessible:
        await create("beta")
    assert inaccessible.value.status == 404
    async with database.sessions() as session:
        session.info["owner_user_id"] = "alpha"
        assert len((await session.scalars(select(VisualProjectFileLink))).all()) == 1
    for action in ("patch", "delete"):
        async with database.sessions() as session:
            links = ProjectFileLinks(cases(session, "beta"))
            with pytest.raises(AssetError) as denied:
                if action == "delete":
                    await links.delete("owned-project", first.reference_id, first.revision)
                else:
                    await links.patch(
                        "owned-project",
                        first.reference_id,
                        VisualAssetReferencePatchIn(
                            expected_revision=first.revision, display_name="Other account"
                        ),
                    )
            assert denied.value.status == 404
