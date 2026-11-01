from __future__ import annotations

import copy
import io
from dataclasses import replace

import httpx
import pytest
from sqlalchemy import select
from starlette.datastructures import UploadFile

from app.apps.desktop_pet import projects
from app.apps.desktop_pet.models import DesktopPetChat, DesktopPetChatMessage
from app.apps.desktop_pet.projects import DesktopPetProjects, PetNotFound
from app.capabilities.identity.route_permissions import route_permission
from app.console.models.accounts import User
from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_owner
from app.runtime.db import SessionLocal
from app.runtime.revisions import RevisionConflictError
from test_desktop_pet import whale_archive
from test_desktop_pet_human import archive, human_model


def wardrobe():
    model = human_model()
    model["character"]["name"] = "素材包里的新名字"
    model["parts"].append(
        {
            "id": "outfit_sit",
            "tex": "outfit_sit",
            "parent": "body",
            "z": 5,
            "box": [64, 64, 64, 64],
            "grid": [2, 2],
        }
    )
    for name in ("lab", "maid"):
        model["schemes"].append(
            {
                "id": f"kurisu-{name}",
                "outfit": {"standingParts": ["coat"], "seatedParts": ["outfit_sit"]},
            }
        )
    return model


async def imported(client):
    response = await client.post(
        "/v1/desktop-pet/projects/import-whale",
        files={"file": ("classic.zip", archive(human_model()), "application/zip")},
    )
    assert response.status_code == 200, response.text
    pet = response.json()
    base = f"/v1/desktop-pet/projects/{pet['id']}"
    return pet, base, (await client.get(f"{base}/document")).json()


@pytest.mark.asyncio
async def test_replace_package_preserves_project_configuration_chat_and_switches_assets():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pet, base, original = await imported(client)
        config = original["config"]
        config["persona"]["personality"] = "用户保存的人格"
        config["habits"]["size"] = 250
        config["events"]["click"]["lines"] = ["用户自己的台词"]
        saved = await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        assert saved.status_code == 200
        await client.patch(base, json={"expectedRevision": 1, "title": "助手"})
        async with SessionLocal() as session:
            if not await session.get(User, "test-user"):
                session.add(
                    User(
                        id="test-user",
                        username="package-test",
                        username_normalized="package-test",
                        password_hash="test",
                    )
                )
                await session.commit()
        chat = (await client.get(f"{base}/chat")).json()
        chat = (
            await client.patch(
                f"{base}/chat",
                json={
                    "expectedRevision": chat["revision"],
                    "modelId": None,
                    "presentationMode": "dialogue",
                    "proactiveLinesEnabled": False,
                },
            )
        ).json()
        # Only the temporary test database is seeded, including an active generation.
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(DesktopPetChat).where(DesktopPetChat.project_id == pet["id"])
                )
            ).scalar_one()
            row.active_request_id = "in-flight"
            session.add(
                DesktopPetChatMessage(
                    chat_id=row.id,
                    position=1,
                    role="assistant",
                    content="实验记录还在。",
                    status="complete",
                )
            )
            await session.commit()
        old_chat = (await client.get(f"{base}/chat")).json()
        response = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": "2"},
            files={"file": ("wardrobe.zip", archive(wardrobe()), "application/zip")},
        )
        assert response.status_code == 200, response.text
        updated = response.json()
        assert updated["revision"] == 3 and updated["config"] == config
        assert len(updated["whaleModel"]["schemes"]) == 3
        assert set(updated["whaleAssets"].values()).isdisjoint(original["whaleAssets"].values())
        for url in updated["assetUrls"].values():
            assert (await client.get(url)).status_code == 200
        assert (await client.get(next(iter(original["assetUrls"].values())))).status_code == 404
        after = (await client.get(base)).json()
        assert after["id"] == pet["id"] and after["title"] == "助手"
        assert after["sourceTitle"] == pet["sourceTitle"]
        assert (await client.get(after["thumbnailUrl"])).status_code == 200
        assert (await client.get(f"{base}/chat")).json() == old_chat
        async with SessionLocal() as session:
            row = (
                await session.execute(
                    select(DesktopPetChat).where(DesktopPetChat.project_id == pet["id"])
                )
            ).scalar_one()
            assert row.active_request_id == "in-flight"
            with pytest.raises(PetNotFound):
                await DesktopPetProjects(session, "foreign").replace_package(
                    pet["id"], 3, UploadFile(io.BytesIO(archive(wardrobe())))
                )
        assert route_permission("POST", f"{base}/replace-package") == "content.write"


@pytest.mark.asyncio
async def test_invalid_stale_and_missing_revision_packages_leave_original_intact():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        _, base, original = await imported(client)
        bad_default = wardrobe()
        bad_default["schemes"][0]["id"] = "different-default"
        wrong_rig = human_model()
        wrong_rig["rigProfile"] = "uploaded-code"
        for data, revision, status in [
            (b"broken", "0", 422),
            (archive(bad_default), "0", 422),
            (archive(wrong_rig), "0", 422),
            (whale_archive(), "0", 422),
            (archive(wardrobe()), "99", 409),
            (archive(wardrobe()), None, 422),
        ]:
            response = await client.post(
                f"{base}/replace-package",
                data={} if revision is None else {"expectedRevision": revision},
                files={"file": ("pack.zip", data, "application/zip")},
            )
            assert response.status_code == status, response.text
            assert (await client.get(f"{base}/document")).json() == original
        assert (await client.get(next(iter(original["assetUrls"].values())))).status_code == 200


@pytest.mark.asyncio
async def test_late_cas_conflict_returns_current_document_and_workspace_http_isolation(monkeypatch):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pet, base, original = await imported(client)
        async with SessionLocal() as session:
            service = DesktopPetProjects(session, "test-user")
            directory = service.whale_path(
                pet["id"], next(iter(original["whaleAssets"].values()))
            ).parent
            files_before = set(directory.iterdir())
        original_cas = projects.patch_revisioned_project

        async def concurrent_save(*args, **kwargs):
            monkeypatch.setattr(projects, "patch_revisioned_project", original_cas)
            changed = await client.patch(
                base, json={"expectedRevision": 0, "title": "其他窗口保存"}
            )
            assert changed.status_code == 200
            await original_cas(*args, **kwargs)

        monkeypatch.setattr(projects, "patch_revisioned_project", concurrent_save)
        response = await client.post(
            f"{base}/replace-package",
            data={"expectedRevision": "0"},
            files={"file": ("wardrobe.zip", archive(wardrobe()), "application/zip")},
        )
        assert response.status_code == 409, response.text
        assert set(directory.iterdir()) == files_before
        current = (await client.get(f"{base}/document")).json()
        assert current["revision"] == 1 and current["whaleAssets"] == original["whaleAssets"]
        assert (await client.get(base)).json()["title"] == "其他窗口保存"
        default_principal = app.dependency_overrides[require_studio_auth]

        async def foreign(session: SessionDep):
            principal = await default_principal(session)
            bind_owner(session, "foreign")
            return replace(principal, user_id="another-account")

        app.dependency_overrides[require_studio_auth] = foreign
        try:
            assert (
                await client.post(
                    f"{base}/replace-package",
                    data={"expectedRevision": "1"},
                    files={"file": ("wardrobe.zip", archive(wardrobe()), "application/zip")},
                )
            ).status_code == 404
        finally:
            app.dependency_overrides[require_studio_auth] = default_principal
        assert set(directory.iterdir()) == files_before


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["write", "cas"])
async def test_partial_write_or_late_conflict_compensates_only_new_assets(monkeypatch, failure):
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        pet, base, original = await imported(client)
        async with SessionLocal() as session:
            service = DesktopPetProjects(session, "test-user")
            paths = [
                service.whale_path(pet["id"], asset) for asset in original["whaleAssets"].values()
            ]
            directory = paths[0].parent
            before = set(directory.iterdir())
            if failure == "write":

                def partial(images):
                    path, content = next(iter(images.items()))
                    path.write_bytes(content)
                    raise OSError("injected disk failure")

                monkeypatch.setattr(projects, "_write_package_images", partial)
                expected_error = OSError
            else:

                async def late_conflict(*_args, **_kwargs):
                    raise RevisionConflictError(0, 1, original)

                monkeypatch.setattr(projects, "patch_revisioned_project", late_conflict)
                expected_error = RevisionConflictError
            with pytest.raises(expected_error):
                await service.replace_package(
                    pet["id"], 0, UploadFile(io.BytesIO(archive(wardrobe())))
                )
            assert set(directory.iterdir()) == before
            assert all(path.is_file() for path in paths)
        assert (await client.get(f"{base}/document")).json() == original


@pytest.mark.parametrize(
    "outfit",
    [
        {"standingParts": ["missing"], "seatedParts": ["outfit_sit"]},
        {"standingParts": ["coat"], "seatedParts": ["coat"]},
        {"standingParts": ["coat", "coat"], "seatedParts": ["outfit_sit"]},
        {"standingParts": [], "seatedParts": ["outfit_sit"]},
        {"standingParts": "coat", "seatedParts": ["outfit_sit"]},
    ],
)
def test_outfit_pose_references_are_validated(outfit):
    model = copy.deepcopy(wardrobe())
    model["schemes"][1]["outfit"] = outfit
    with pytest.raises(ValueError):
        projects.read_whale_package(archive(model))
