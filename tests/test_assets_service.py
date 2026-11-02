"""Actual Assets ASGI owns its tables and all registered public file operations."""

import json
from io import BytesIO
from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from PIL import Image

from fpl_assets.application import create_app
from fpl_assets.migrations.registry import MIGRATIONS
from fpl_assets.settings import StorageSettings
from fpl_runtime.claims import Actor, issue_context
from fpl_runtime.migrations import apply
from fpl_runtime.protocol_hash import public_contract
from fpl_runtime.routing import RouteCatalog

ROOT = Path(__file__).resolve().parents[1]
CATALOG = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")


class Identity:
    async def can_prepare_retention(self, _authority):
        return True

    async def close(self):
        pass


class Projects:
    def __init__(self):
        self.requests = []

    async def project_exists(self, **arguments):
        self.requests.append(arguments)
        return arguments["project_id"] == "owned-project"

    async def close(self):
        pass


@pytest.fixture
async def instance(tmp_path):
    private = Ed25519PrivateKey.generate()
    projects = Projects()
    apply(tmp_path / "service.db", "assets", MIGRATIONS)
    app = create_app(
        settings=StorageSettings(tmp_path / "service.db"),
        catalog=CATALOG,
        public_key=private.public_key(),
        identity=Identity(),
        capabilities=projects,
        cleanup=False,
    )
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://assets"
        ) as client:
            yield app, client, private, projects


def headers(private, method, path, owner="alpha"):
    return {
        "X-Fpl-Context": issue_context(
            Actor(
                owner,
                "user",
                "session",
                ("studio:read", "studio:private_read", "studio:write"),
                session_id=owner + "-session",
            ),
            service="assets",
            method=method,
            path=path,
            private_key=private,
            key_id="test",
        )
    }


async def test_public_file_contract_is_identical_to_the_aggregated_contract(instance):
    app, _client, _private, _projects = instance
    source = json.loads((ROOT / "web/src/generated/openapi.json").read_text())
    assert public_contract(app.openapi(), "assets", CATALOG) == public_contract(
        source, "assets", CATALOG
    )
    assert not any(path.startswith("/_internal/") for path in app.openapi()["paths"])


async def test_owned_upload_download_range_and_folder_links(instance):
    app, client, private, projects = instance
    png = BytesIO()
    Image.new("RGB", (20, 20), color="blue").save(png, format="PNG")
    response = await client.post(
        "/v1/files",
        headers=headers(private, "POST", "/v1/files"),
        files={"upload": ("test.png", png.getvalue(), "image/png")},
    )
    assert response.status_code == 200, response.text
    uploaded = response.json()
    path = f"/v1/files/{uploaded['id']}/content"
    response = await client.get(
        path, headers={**headers(private, "GET", path), "Range": "bytes=0-7"}
    )
    assert response.status_code == 206 and response.content == png.getvalue()[:8]
    assert response.headers["cache-control"] == "no-store"
    denied = await client.get(path, headers=headers(private, "GET", path, "beta"))
    assert denied.status_code == 404
    project_path = "/v1/visual-workshop/projects/owned-project/asset-references"
    response = await client.post(
        project_path,
        headers=headers(private, "POST", project_path),
        json={"asset_id": uploaded["id"]},
    )
    assert response.status_code == 200, response.text
    link = response.json()
    response = await client.get(
        "/v1/files?project_id=owned-project", headers=headers(private, "GET", "/v1/files")
    )
    assert [row["reference_id"] for row in response.json()["items"]] == [link["reference_id"]]
    assert projects.requests[-1]["source_path"] == "/v1/files"
    delete_path = f"/v1/files/{uploaded['id']}"
    response = await client.delete(
        delete_path + "?expected_revision=0", headers=headers(private, "DELETE", delete_path)
    )
    assert response.status_code == 409 and response.json()["code"] == "asset_in_use"
    response = await client.get(
        "/v1/file-storage/layout", headers=headers(private, "GET", "/v1/file-storage/layout")
    )
    assert response.status_code == 200 and response.json()["complete"] is True
    for unknown in ("/v1/model-entries", "/v1/files/missing/content", "/v1/unknown", "/missing.js"):
        response = await client.get(unknown, headers=headers(private, "GET", unknown))
        assert response.status_code == 404
        assert response.headers["cache-control"] == "no-store"
    assert (await client.get("/ready")).status_code == 200
    assert app.state.database.service == "assets"


async def test_owned_program_cache_is_immutable_while_api_and_unknown_resources_are_private(
    instance, tmp_path
):
    import hashlib

    from fpl_runtime.web import attach_web, load_release

    app, client, private, _projects = instance
    directory = tmp_path / "program"
    directory.mkdir()
    (directory / "assets").mkdir()
    entries = {
        "assets.html": b"<html>Files</html>",
        "assets/main.js": b"console.log('isolated files');",
    }
    for name, body in entries.items():
        (directory / name).write_bytes(body)
    (directory / "build.json").write_text(
        json.dumps(
            {
                "version": 1,
                "service": "assets",
                "build_id": "a" * 20,
                "entry": "assets.html",
                "api_sha256": public_contract(app.openapi(), "assets", CATALOG),
                "files": [
                    {"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                    for name, body in entries.items()
                ],
            }
        )
    )
    attach_web(app, load_release(directory, "assets"), pages=("/files",))
    prefix = "/_apps/assets/" + "a" * 20
    response = await client.get(prefix + "/assets/main.js")
    assert response.status_code == 200 and "immutable" in response.headers["cache-control"]
    assert (
        await client.get(
            prefix + "/assets/main.js", headers={"If-None-Match": response.headers["etag"]}
        )
    ).status_code == 304
    assert (await client.get(prefix + "/assets/missing.js")).status_code == 404
    assert (await client.get("/files")).headers["cache-control"] == "no-cache"
    api = await client.get("/v1/files", headers=headers(private, "GET", "/v1/files"))
    assert api.status_code == 200 and api.headers["cache-control"] == "no-store"


async def test_archive_upload_dispatches_to_owned_archive_case(instance):
    import zipfile

    _app, client, private, _projects = instance
    packed = BytesIO()
    with zipfile.ZipFile(packed, "w") as bundle:
        bundle.writestr("folder/readme.txt", "owned archive")
    path = "/v1/file-library/folder-archive-imports"
    response = await client.post(
        path,
        headers=headers(private, "POST", path),
        files={"archive": ("fixture.zip", packed.getvalue(), "application/zip")},
    )
    assert response.status_code == 200, response.text
    assert response.json()["created_files"] == 1
    response = await client.get(
        "/v1/file-folders", headers=headers(private, "GET", "/v1/file-folders")
    )
    folder = response.json()["items"][0]
    response = await client.get(
        "/v1/files?folder_id=" + folder["id"], headers=headers(private, "GET", "/v1/files")
    )
    assert response.json()["items"][0]["original_filename"] == "readme.txt"
