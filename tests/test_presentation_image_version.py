import copy
import io
import json
import sqlite3
from contextlib import aclosing
from zipfile import ZipFile

import httpx
import pytest
from PIL import Image
from tests.presentation_helpers import sample_document

from db.migrations.versions.r0097_presentation_image_version import SQL
from website_test_support import app

ROOT = "/v1/presentation-workshop/projects"


async def upload(client, name="generated.png"):
    image = io.BytesIO()
    Image.new("RGB", (24, 12), "teal").save(image, "PNG")
    result = await client.post("/v1/files", files={"upload": (name, image.getvalue(), "image/png")})
    assert result.status_code == 200, result.text
    return result.json()


async def delete_asset(client, asset):
    return await client.delete(
        f"/v1/files/{asset['id']}", params={"expected_revision": asset["revision"]}
    )


def test_image_version_migration_only_fills_missing_fields(tmp_path):
    original = sample_document().model_dump()
    original["slides"][0].pop("image_asset_id")
    original["slides"][1]["image_asset_id"] = "already-archived"
    with sqlite3.connect(tmp_path / "archive.db") as connection:
        connection.execute("CREATE TABLE presentation_projects(document JSON, revision INTEGER)")
        connection.execute(
            "INSERT INTO presentation_projects VALUES (?, 9)", (json.dumps(original),)
        )
        connection.executescript(SQL)
        first = connection.execute(
            "SELECT document, revision FROM presentation_projects"
        ).fetchone()
        connection.executescript(SQL)
        assert (
            connection.execute("SELECT document, revision FROM presentation_projects").fetchone()
            == first
        )
    expected = copy.deepcopy(original)
    expected["slides"][0]["image_asset_id"] = None
    assert json.loads(first[0]) == expected
    assert first[1] == 9


@pytest.mark.asyncio
async def test_image_archive_roundtrip_operations_export_and_reference_lifecycle():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        archived, reference = await upload(client), await upload(client, "reference.png")
        document = sample_document().model_dump()
        document["slides"][0].update(
            image_asset_id=archived["id"], reference={"asset_id": reference["id"]}
        )
        result = await client.post(ROOT, json={"title": "image archive", "document": document})
        assert result.status_code == 200, result.text
        project = result.json()
        url = f"{ROOT}/{project['id']}"
        assert (await client.get(url)).json() == project
        listed = (await client.get(ROOT, params={"query": "image archive"})).json()
        assert listed["items"][0]["first_slide"]["image_asset_id"] == archived["id"]
        assert (await delete_asset(client, archived)).status_code == 409
        assert (await delete_asset(client, reference)).status_code == 409
        exported = await client.post(url + "/export", json={"expected_revision": 0})
        assert exported.status_code == 200, exported.text
        with ZipFile(io.BytesIO(exported.content)) as archive:
            assert not any(name.startswith("ppt/media/") for name in archive.namelist())

        async def operation(revision, request_id, operations):
            body = {
                "expected_revision": revision,
                "request_id": request_id,
                "operations": operations,
            }
            changed = await client.post(url + "/operations", json=body)
            assert changed.status_code == 200, changed.text
            assert (await client.post(url + "/operations", json=body)).json() == changed.json()
            return changed.json()

        duplicate = await operation(
            0,
            "copy-archive",
            [
                {
                    "entity": "slide",
                    "action": "duplicate",
                    "id": "slide-one",
                    "value": {"id": "copy"},
                }
            ],
        )
        assert (
            next(s for s in duplicate["document"]["slides"] if s["id"] == "copy")["image_asset_id"]
            == archived["id"]
        )
        cleared = await operation(
            1,
            "clear-original",
            [
                {
                    "entity": "slide",
                    "action": "update",
                    "id": "slide-one",
                    "value": {"image_asset_id": None},
                }
            ],
        )
        assert cleared["document"]["slides"][0]["reference"]["asset_id"] == reference["id"]
        assert (await delete_asset(client, archived)).status_code == 409
        await operation(2, "remove-copy", [{"entity": "slide", "action": "remove", "id": "copy"}])
        assert (await delete_asset(client, archived)).status_code == 200
        assert (await delete_asset(client, reference)).status_code == 409
        assert (await client.delete(url, params={"expected_revision": 3})).status_code == 200
        assert (await delete_asset(client, reference)).status_code == 200


@pytest.mark.asyncio
async def test_archive_replacement_is_atomic_and_requires_current_revision():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        first, second = await upload(client), await upload(client, "replacement.png")
        document = sample_document().model_dump()
        document["slides"][0]["image_asset_id"] = first["id"]
        body = {"title": "archive replacement", "document": document}
        project = (await client.post(ROOT, json=body)).json()
        url = f"{ROOT}/{project['id']}"
        document["slides"][0]["image_asset_id"] = "missing"
        assert (await client.put(url, json={**body, "expected_revision": 0})).status_code == 404
        assert (await client.get(url)).json() == project
        assert (await delete_asset(client, first)).status_code == 409
        document["slides"][0]["image_asset_id"] = second["id"]
        assert (await client.put(url, json=body)).status_code == 422
        replaced = await client.put(url, json={**body, "expected_revision": 0})
        assert replaced.status_code == 200, replaced.text
        assert (await client.put(url, json={**body, "expected_revision": 0})).status_code == 409
        assert (await delete_asset(client, first)).status_code == 200
        assert (await delete_asset(client, second)).status_code == 409


@pytest.mark.real_auth
@pytest.mark.asyncio
async def test_archived_images_cannot_cross_workspaces():
    from test_workspace_governance import client_account

    owner, *_ = await client_account()
    other, *_ = await client_account()
    async with aclosing(owner), aclosing(other):
        asset = await upload(owner)
        body = {"title": "private archive", "document": sample_document().model_dump()}
        body["document"]["slides"][0]["image_asset_id"] = asset["id"]
        assert (await owner.post(ROOT, json=body)).status_code == 200
        assert (await other.post(ROOT, json=body)).status_code == 404
        assert (await other.get(f"/v1/files/{asset['id']}/content")).status_code == 404


@pytest.mark.asyncio
async def test_fragments_cannot_silently_drop_an_archived_page_image():
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        project = (
            await client.post(
                ROOT, json={"title": "fragment archive", "document": sample_document().model_dump()}
            )
        ).json()
        fragment = {
            "id": "fragment-root",
            "elements": [],
            "groups": [{"id": "fragment-root", "element_ids": []}],
            "image_asset_id": "unexpected-page-archive",
        }
        url = f"{ROOT}/{project['id']}"
        result = await client.post(
            url + "/operations",
            json={
                "expected_revision": 0,
                "request_id": "invalid-archive-fragment",
                "operations": [
                    {
                        "entity": "fragment",
                        "action": "insert",
                        "id": "fragment-root",
                        "parent_id": "slide-one",
                        "fragment": fragment,
                    }
                ],
            },
        )
        assert result.status_code == 422, result.text
        assert (await client.get(url)).json() == project
