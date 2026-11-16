"""Real destination-bound identity assertions against a standalone workbook database."""

from pathlib import Path

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from studio.apps.spreadsheet_workshop.storage.migrations.registry import MIGRATIONS
from studio.assembly.independent.spreadsheet_workshop.application import create_app
from studio.contracts.gateway.routing import RouteCatalog
from studio.contracts.identity.claims import HEADER, Actor, issue_context
from studio.runtime.database.migrations import apply

ROOT = Path(__file__).resolve().parents[2]
BASE = "/v1/spreadsheet-workshop"


@pytest.fixture
def standalone(tmp_path):
    key = Ed25519PrivateKey.generate()
    apply(tmp_path / "service.db", "spreadsheet", MIGRATIONS)
    catalog = RouteCatalog.read(ROOT / "deploy/contracts/ownership.json")

    def application():
        return create_app(
            state_root=tmp_path,
            catalog=catalog,
            public_key=key.public_key(),
            schema_path=ROOT / "web/src/generated/openapi.json",
        )

    def headers(method, path, owner="alice", writable=True):
        actor = Actor(
            user_id=owner,
            platform_role="admin",
            auth_kind="management_api_key",
            scopes=("studio:read", "studio:private_read", "studio:write")
            if writable
            else ("studio:read", "studio:private_read"),
            api_key_id="synthetic-test-key",
        )
        return {
            HEADER: issue_context(
                actor,
                service="spreadsheet",
                method=method,
                path=path,
                private_key=key,
                key_id="test",
            )
        }

    return application, headers


async def test_standalone_auth_operations_import_export_and_restart(standalone):
    application, headers = standalone
    app = application()
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app), base_url="http://spreadsheet"
        ) as client,
    ):
        projects = BASE + "/projects"
        assert (await client.get(projects)).status_code == 401
        assert (
            await client.get("/ready")
        ).status_code == 503  # API-only image has no browser release.
        denied = await client.post(
            projects,
            headers=headers("POST", projects, writable=False),
            json={"request_id": "denied"},
        )
        assert denied.status_code == 403
        created = await client.post(
            projects,
            headers=headers("POST", projects),
            json={"request_id": "create", "title": "独立预算"},
        )
        assert created.status_code == 200, created.text
        identity = created.json()["id"]
        resource = projects + "/" + identity
        assert (
            await client.get(resource, headers=headers("GET", resource, "bob"))
        ).status_code == 404
        assert (await client.get(projects, headers=headers("GET", projects, "bob"))).json()[
            "total"
        ] == 0
        operation = resource + "/operations"
        body = {
            "request_id": "op",
            "expected_revision": 0,
            "operations": [
                {
                    "action": "set_cells",
                    "sheet_id": "sheet-1",
                    "cells": [
                        {"r": 0, "c": 0, "v": {"v": 10}},
                        {"r": 1, "c": 0, "v": {"f": "=SUM(A1,5)"}},
                    ],
                }
            ],
        }
        edited = await client.post(operation, headers=headers("POST", operation), json=body)
        assert edited.status_code == 200, edited.text
        assert edited.json()["calculation"] == "pending"
        assert (
            await client.post(operation, headers=headers("POST", operation), json=body)
        ).json() == edited.json()
        stale = await client.put(
            resource,
            headers=headers("PUT", resource),
            json={
                "request_id": "stale",
                "expected_revision": 0,
                "title": "覆盖",
                "document": created.json()["document"],
            },
        )
        assert stale.status_code == 409 and stale.json()["current"]["revision"] == 1
        region = resource + "/range"
        result = await client.get(
            region, headers=headers("GET", region), params={"sheet_id": "sheet-1", "range": "A1:A2"}
        )
        assert result.json()["cells"][1]["formula"] == "=SUM(A1,5)"
        export = resource + "/export"
        output = await client.post(
            export, headers=headers("POST", export), json={"expected_revision": 1}
        )
        assert output.status_code == 200 and output.content.startswith(b"PK")
        pending = await client.post(
            export, headers=headers("POST", export), json={"expected_revision": 1, "format": "csv"}
        )
        assert (
            pending.status_code == 409 and pending.json()["code"] == "formula_calculation_pending"
        )
        preview_path = BASE + "/imports/preview"
        preview = await client.post(
            preview_path,
            headers=headers("POST", preview_path),
            files={"file": ("导入.csv", "列,值\n中文,0012".encode())},
        )
        assert preview.status_code == 200, preview.text
        confirm_path = BASE + "/imports/" + preview.json()["id"] + "/confirm"
        imported = await client.post(
            confirm_path,
            headers=headers("POST", confirm_path),
            json={
                "request_id": "import",
                "sha256": preview.json()["sha256"],
                "converter": preview.json()["converter"],
            },
        )
        assert imported.status_code == 200, imported.text
        original = projects + "/" + imported.json()["id"] + "/original"
        assert (
            await client.get(original, headers=headers("GET", original))
        ).content == "列,值\n中文,0012".encode()
        assert (
            await client.get(original, headers=headers("GET", original, "bob"))
        ).status_code == 404
    restarted = application()
    async with (
        restarted.router.lifespan_context(restarted),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(restarted), base_url="http://spreadsheet"
        ) as client,
    ):
        result = await client.get(resource, headers=headers("GET", resource))
        assert result.status_code == 200 and result.json()["revision"] == 1
        assert (await client.get(original, headers=headers("GET", original))).status_code == 200


async def test_generated_sdk_multipart_and_downloads_against_real_service(standalone):
    from future_props_lab import AsyncClient

    application, headers = standalone
    app = application()
    destination = httpx.ASGITransport(app)

    async def signed_transport(request):
        assert request.headers["authorization"] == "Bearer synthetic-sdk-key"
        request.headers.update(headers(request.method, request.url.path))
        return await destination.handle_async_request(request)

    async with (
        app.router.lifespan_context(app),
        AsyncClient(
            base_url="http://spreadsheet",
            api_key="synthetic-sdk-key",
            transport=httpx.MockTransport(signed_transport),
        ) as client,
    ):
        preview = await client.spreadsheet.preview_import(
            body={}, files={"file": ("sdk.csv", b"name,value\nAlice,12")}
        )
        imported = await client.spreadsheet.confirm_import(
            import_id=preview.id,
            body={
                "request_id": "sdk-import",
                "sha256": preview.sha256,
                "converter": preview.converter,
            },
        )
        listed = await client.spreadsheet.list_projects()
        assert listed.total == 1 and listed.items[0].id == imported.id
        selected = await client.spreadsheet.read_range(
            project_id=imported.id, sheet_id="sheet-1", range="A2:B2"
        )
        assert [cell.value for cell in selected.cells] == ["Alice", 12]
        async with await client.spreadsheet.download_original(project_id=imported.id) as output:
            assert b"".join([part async for part in output.iter_bytes()]) == b"name,value\nAlice,12"
        async with await client.spreadsheet.export_workbook(
            project_id=imported.id, body={"expected_revision": 0}
        ) as output:
            assert b"".join([part async for part in output.iter_bytes()]).startswith(b"PK")
