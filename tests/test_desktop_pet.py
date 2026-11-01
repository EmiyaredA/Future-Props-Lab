from __future__ import annotations

import copy
import io
import json
import zipfile
from pathlib import Path

import httpx
import pytest
from PIL import Image

from app.apps.desktop_pet.projects import DesktopPetProjects, PetNotFound
from app.capabilities.identity.principal import StudioPrincipal
from app.deps import SessionDep, require_studio_auth
from app.main import app
from app.orm import bind_owner
from app.runtime.db import SessionLocal

CHARACTER = json.loads((Path(__file__).parent / "fixtures/live2d-evaluation.json").read_text())[
    "document"
]


def png(size: tuple[int, int] = (16, 16)) -> bytes:
    output = io.BytesIO()
    Image.new("RGBA", size, (240, 130, 95, 255)).save(output, format="PNG")
    return output.getvalue()


async def source(client: httpx.AsyncClient) -> tuple[dict, str, dict]:
    created = await client.post("/v1/live2d-workshop/projects", json={"title": "来源角色"})
    assert created.status_code == 200, created.text
    base = f"/v1/live2d-workshop/projects/{created.json()['id']}"
    asset = await client.post(f"{base}/assets", files={"file": ("body.png", png(), "image/png")})
    assert asset.status_code == 200, asset.text
    character = copy.deepcopy(CHARACTER)
    character["parts"][0]["assetId"] = asset.json()["id"]
    saved = await client.put(
        f"{base}/document", json={"expectedRevision": 0, "document": character}
    )
    assert saved.status_code == 200, saved.text
    return {"id": created.json()["id"], "revision": saved.json()["revision"]}, base, character


@pytest.mark.asyncio
async def test_pet_snapshot_skin_events_and_cas_survive_source_delete():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        saved, source_base, character = await source(client)
        created = await client.post(
            "/v1/desktop-pet/projects",
            json={"title": "小伙伴", "sourceProjectId": saved["id"], "sourceRevision": 1},
        )
        assert created.status_code == 200, created.text
        pet_id = created.json()["id"]
        base = f"/v1/desktop-pet/projects/{pet_id}"
        first = (await client.get(f"{base}/document")).json()
        asset_id = character["parts"][0]["assetId"]
        assert (await client.get(first["assetUrls"][asset_id])).content == png()
        async with SessionLocal() as session:
            with pytest.raises(PetNotFound):
                await DesktopPetProjects(session, "other-workspace").get(pet_id)
        original_principal = app.dependency_overrides[require_studio_auth]

        async def other_principal(session: SessionDep) -> StudioPrincipal:
            bind_owner(session, "other-workspace")
            return StudioPrincipal(
                user_id="other-user",
                platform_role="admin",
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other-session",
            )

        app.dependency_overrides[require_studio_auth] = other_principal
        try:
            assert (await client.get(base)).status_code == 404
            assert (await client.get(f"{base}/document")).status_code == 404
        finally:
            app.dependency_overrides[require_studio_auth] = original_principal
        config = first["config"]
        config["skins"] = [{"id": "red", "name": "红衣", "replacements": {}}]
        config["activeSkinId"] = "red"
        config["events"] = {
            "click": {
                "motionId": "nod",
                "expressionId": "smile-exp",
                "bubble": "你好",
                "sound": "tap",
            }
        }
        updated = await client.put(
            f"{base}/document", json={"expectedRevision": 0, "config": config}
        )
        assert updated.status_code == 200, updated.text
        assert updated.json()["revision"] == 1
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        ).status_code == 409
        bad = copy.deepcopy(config)
        bad["events"]["click"]["motionId"] = "not-a-motion"
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "config": bad})
        ).status_code == 422
        path = f"{base}/skins/red/replacements/{asset_id}"
        wrong = await client.put(
            path,
            data={"expectedRevision": "1"},
            files={"file": ("wrong.png", png((10, 10)), "image/png")},
        )
        assert wrong.status_code == 422
        skin = await client.put(
            path, data={"expectedRevision": "1"}, files={"file": ("red.png", png(), "image/png")}
        )
        assert skin.status_code == 200, skin.text
        replacement = skin.json()["config"]["skins"][0]["replacements"][asset_id]
        assert (await client.get(skin.json()["assetUrls"][replacement])).content == png()
        assert (await client.get(f"{base}/document")).json()["config"] == skin.json()["config"]
        assert (await client.delete(source_base, params={"expectedRevision": 1})).status_code == 200
        assert (await client.get(f"{base}/document")).status_code == 200
        assert (await client.get(skin.json()["assetUrls"][asset_id])).status_code == 200
        renamed = await client.patch(base, json={"expectedRevision": 2, "title": "新名字"})
        assert renamed.status_code == 200, renamed.text
        assert renamed.json()["title"] == "新名字"
        assert (
            await client.patch(base, json={"expectedRevision": 2, "title": "旧改动"})
        ).status_code == 409
        assert (await client.delete(base, params={"expectedRevision": 3})).status_code == 200
        assert (await client.get(base)).status_code == 404


@pytest.mark.asyncio
async def test_source_update_rejects_incompatible_reaction_and_keeps_snapshot():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        saved, source_base, character = await source(client)
        created = await client.post(
            "/v1/desktop-pet/projects",
            json={"sourceProjectId": saved["id"], "sourceRevision": 1},
        )
        assert created.status_code == 200, created.text
        base = f"/v1/desktop-pet/projects/{created.json()['id']}"
        config = (await client.get(f"{base}/document")).json()["config"]
        config["events"] = {"click": {"motionId": "nod"}}
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        ).status_code == 200
        next_character = copy.deepcopy(character)
        next_character["motions"] = []
        newer = await client.put(
            f"{source_base}/document", json={"expectedRevision": 1, "document": next_character}
        )
        assert newer.status_code == 200, newer.text
        conflict = await client.post(
            f"{base}/sync-source", json={"expectedRevision": 1, "sourceRevision": 2}
        )
        assert conflict.status_code == 422
        unchanged = (await client.get(f"{base}/document")).json()
        assert unchanged["sourceRevision"] == 1
        assert unchanged["revision"] == 1
        config["events"] = {}
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "config": config})
        ).status_code == 200
        synced = await client.post(
            f"{base}/sync-source", json={"expectedRevision": 2, "sourceRevision": 2}
        )
        assert synced.status_code == 200, synced.text
        assert synced.json()["sourceRevision"] == 2


def whale_archive() -> bytes:
    part_names = (
        "body",
        "skirt",
        "skirt_sit",
        "tail",
        "hair_back",
        "bangs",
        "brows",
        "eye_creases",
    )
    model = {
        "units": {"S": 0.19, "X0": 650, "FEET": 1363},
        "pivots": {
            key: [128, 128]
            for key in (
                "body",
                "armNear",
                "armFar",
                "legBack",
                "legFront",
                "tail",
                "neck",
                "finNear",
                "finFar",
                "ahoge",
            )
        },
        "view": [-12, -8, 268, 272],
        "parts": [
            {"id": name, "tex": name, "grid": [2, 2], "box": [0, 0, 100, 100]}
            for name in part_names
        ],
        "feat": {
            "sprites": {"neutral_mouth": [0, 0, 1, 1]},
            "eyes": {"eyeL": {}, "eyeR": {}},
        },
        "schemes": [{"id": "deepseek", "brand": "DeepSeek"}, {"id": "harness", "brand": "Harness"}],
    }
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "manifest.json", json.dumps({"format": "fpl-coopanion-whale", "version": 1})
        )
        archive.writestr("model.json", json.dumps(model))
        for prefix in ("", "schemes/harness/"):
            for name in (
                *(f"tex/{part}.png" for part in part_names),
                "feat/neutral_mouth.png",
                "feat/eyeL_lash.png",
                "feat/eyeL_ball.png",
                "feat/eyeL_iris.png",
                "feat/eyeR_lash.png",
                "feat/eyeR_ball.png",
                "feat/eyeR_iris.png",
            ):
                archive.writestr(prefix + name, png())
        archive.writestr("thumbs/deepseek.png", png())
        archive.writestr("thumbs/harness.png", png())
    return output.getvalue()


@pytest.mark.asyncio
async def test_whale_import_is_frozen_workspace_scoped_and_cas_validated(tmp_path: Path):
    package = tmp_path / "whale.zip"
    package.write_bytes(whale_archive())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        created = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("whale.zip", package.read_bytes(), "application/zip")},
        )
        assert created.status_code == 200, created.text
        project = created.json()
        assert project["sourceType"] == "coopanion-whale"
        assert project["thumbnailUrl"]
        package.unlink()
        base = f"/v1/desktop-pet/projects/{project['id']}"
        document = (await client.get(f"{base}/document")).json()
        assert document["whaleModel"]["schemes"][1]["id"] == "harness"
        thumb = await client.get(project["thumbnailUrl"])
        assert thumb.status_code == 200 and thumb.content == png()
        config = document["config"]
        config["schemeId"] = "harness"
        config["events"] = {"click": {"motionId": "hop", "expressionId": "happy", "bubble": "你好"}}
        saved = await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        assert saved.status_code == 200, saved.text
        assert saved.json()["config"]["schemeId"] == "harness"
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 0, "config": config})
        ).status_code == 409
        bad = copy.deepcopy(config)
        bad["schemeId"] = "unknown"
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "config": bad})
        ).status_code == 422
        bad = copy.deepcopy(config)
        bad["events"]["click"]["motionId"] = "unknown"
        assert (
            await client.put(f"{base}/document", json={"expectedRevision": 1, "config": bad})
        ).status_code == 422
        assert (
            await client.post(
                f"{base}/sync-source", json={"expectedRevision": 1, "sourceRevision": 1}
            )
        ).status_code == 422
        async with SessionLocal() as session:
            with pytest.raises(PetNotFound):
                await DesktopPetProjects(session, "other-workspace").get(project["id"])
        original_principal = app.dependency_overrides[require_studio_auth]

        async def other_principal(session: SessionDep) -> StudioPrincipal:
            bind_owner(session, "other-workspace")
            return StudioPrincipal(
                user_id="other-user",
                platform_role="admin",
                must_change_password=False,
                auth_kind="session",
                scopes=frozenset({"studio:read", "studio:private_read", "studio:write"}),
                session_id="other-session",
            )

        app.dependency_overrides[require_studio_auth] = other_principal
        try:
            assert (await client.get(base)).status_code == 404
            assert (await client.get(f"{base}/document")).status_code == 404
            assert (await client.get(project["thumbnailUrl"])).status_code == 404
        finally:
            app.dependency_overrides[require_studio_auth] = original_principal
        assert (await client.get(f"{base}/document")).json()["config"]["schemeId"] == "harness"


@pytest.mark.asyncio
async def test_whale_import_rejects_unsafe_and_incomplete_packages():
    package = whale_archive()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        incomplete = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(package)) as original,
            zipfile.ZipFile(incomplete, "w") as output,
        ):
            for name in original.namelist():
                if name != "tex/body.png":
                    output.writestr(name, original.read(name))
        response = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("missing.zip", incomplete.getvalue(), "application/zip")},
        )
        assert response.status_code == 422
        unsafe = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(package)) as original,
            zipfile.ZipFile(unsafe, "w") as output,
        ):
            for name in original.namelist():
                output.writestr(name, original.read(name))
            output.writestr("../escape.png", png())
        response = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("unsafe.zip", unsafe.getvalue(), "application/zip")},
        )
        assert response.status_code == 422
        wrong_size = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(package)) as original,
            zipfile.ZipFile(wrong_size, "w") as output,
        ):
            for name in original.namelist():
                output.writestr(
                    name,
                    png((32, 16))
                    if name == "schemes/harness/tex/body.png"
                    else original.read(name),
                )
        response = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("wrong-size.zip", wrong_size.getvalue(), "application/zip")},
        )
        assert response.status_code == 422
        invalid_png = io.BytesIO()
        with (
            zipfile.ZipFile(io.BytesIO(package)) as original,
            zipfile.ZipFile(invalid_png, "w") as output,
        ):
            for name in original.namelist():
                output.writestr(
                    name,
                    b"not a PNG" if name == "tex/body.png" else original.read(name),
                )
        response = await client.post(
            "/v1/desktop-pet/projects/import-whale",
            files={"file": ("invalid-png.zip", invalid_png.getvalue(), "application/zip")},
        )
        assert response.status_code == 422
