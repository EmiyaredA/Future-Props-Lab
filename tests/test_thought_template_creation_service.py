"""Template creation crosses real isolated Identity and Assets services."""

import json
from io import BytesIO
from zipfile import ZipFile

import httpx
from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    CATALOG,
    GATEWAY_SECRET,
    PASSWORD,
    PEER_SECRET,
    THOUGHT_SECRET,
    scenario,  # noqa: F401
)

from fpl_assets.models import AssetReferencePin, AssetReferenceSet
from fpl_runtime.claims import HEADER
from fpl_runtime.identity_client import LiveAuthorization
from fpl_runtime.retention_client import RetentionClient
from fpl_thought.application import create_app


async def test_create_template_pins_same_account_assets_over_http(scenario):  # noqa: F811
    case = scenario
    from app.apps.thought_workshop.models import ThoughtKnowledgeBase
    from app.apps.thought_workshop.publication.models import PublishedArticle

    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        book = await session.get(ThoughtKnowledgeBase, "book")
        book.home_note_id = "note"
        article = await session.get(PublishedArticle, ("pub", "note"))
        article.visibility = "members"
        await session.commit()
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    app = create_app(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=RetentionClient(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )
    path = "/v1/thought-workshop/templates"
    body = {
        "name": "Image template",
        "document": {
            "type": "doc",
            "content": [{"type": "image", "attrs": {"assetId": case.asset}}],
        },
    }

    async def context(browser, source_path=path, method="POST"):
        response = await browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": method,
                "X-Fpl-Request-Uri": source_path,
                "X-CSRF-Token": browser.cookies["fpl_csrf"],
                "Origin": "http://127.0.0.1:19000",
            },
        )
        assert response.status_code == 204, response.text
        return {HEADER: response.headers[HEADER]}

    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://thought"
        ) as client:
            denied = await client.post(path, headers=await context(case.browser), json=body)
            assert denied.status_code == 404, denied.text
            async with httpx.AsyncClient(
                transport=httpx.ASGITransport(app=case.identity),
                base_url="http://127.0.0.1:19000",
                headers={
                    "X-Fpl-Gateway": GATEWAY_SECRET,
                    "X-Fpl-Ingress": "local",
                    "X-Fpl-Client-Ip": "127.0.0.1",
                },
            ) as owner:
                login = await owner.post(
                    "/v1/auth/login", json={"username": "source-owner", "password": PASSWORD}
                )
                assert login.status_code == 200
                created = await client.post(path, headers=await context(owner), json=body)
                assert created.status_code == 200, created.text
                template = created.json()
                assert template["revision"] == 0
                apply_path = f"{path}/{template['id']}/apply"
                apply_body = {
                    "knowledge_base_id": "book",
                    "title": "From template",
                    "expected_revision": 0,
                    "expected_knowledge_revision": 0,
                }
                outsider = await client.post(
                    apply_path, headers=await context(case.browser, apply_path), json=apply_body
                )
                assert outsider.status_code == 404
                applied = await client.post(
                    apply_path, headers=await context(owner, apply_path), json=apply_body
                )
                assert applied.status_code == 200, applied.text
                note = applied.json()
                conflict = await client.post(
                    apply_path, headers=await context(owner, apply_path), json=apply_body
                )
                assert conflict.status_code == 409
                table_body = {
                    "name": "Table template",
                    "kind": "multitable",
                    "document": {"type": "doc", "content": [{"type": "paragraph"}]},
                    "multitable": {
                        "tables": [
                            {
                                "id": "t",
                                "name": "Table",
                                "position": 0,
                                "fields": [
                                    {"id": "name", "name": "Name", "type": "text", "position": 0},
                                    {
                                        "id": "f",
                                        "name": "File",
                                        "type": "attachment",
                                        "position": 1,
                                    },
                                ],
                                "views": [{"id": "v", "name": "Grid", "position": 0}],
                            }
                        ],
                        "records": {
                            "t": [{"id": "r", "position": 0, "values": {"f": [case.asset]}}]
                        },
                    },
                }
                table_created = await client.post(
                    path, headers=await context(owner), json=table_body
                )
                assert table_created.status_code == 200, table_created.text
                table_path = f"{path}/{table_created.json()['id']}/apply"
                table_apply = await client.post(
                    table_path,
                    headers=await context(owner, table_path),
                    json={
                        "knowledge_base_id": "book",
                        "title": "Table note",
                        "expected_revision": 0,
                        "expected_knowledge_revision": 1,
                    },
                )
                assert table_apply.status_code == 200, table_apply.text
                table_note = table_apply.json()
                note_path = "/v1/thought-workshop/notes"
                note_body = {
                    "knowledge_base_id": "book",
                    "title": "Direct",
                    "expected_knowledge_revision": 2,
                    "document": body["document"],
                }
                denied = await client.post(
                    note_path, headers=await context(case.browser, note_path), json=note_body
                )
                assert denied.status_code == 404
                direct = await client.post(
                    note_path, headers=await context(owner, note_path), json=note_body
                )
                assert direct.status_code == 200, direct.text
                stale = await client.post(
                    note_path, headers=await context(owner, note_path), json=note_body
                )
                assert stale.status_code == 409
                document_path = "/v1/thought-workshop/knowledge-bases/book/documents"
                document = await client.post(
                    document_path,
                    headers=await context(owner, document_path),
                    json={"title": "Blank", "expected_revision": 3},
                )
                assert document.status_code == 200, document.text
                knowledge_path = "/v1/thought-workshop/knowledge-bases"
                knowledge_body = {"title": "Covered book", "cover_asset_id": case.asset}
                denied = await client.post(
                    knowledge_path,
                    headers=await context(case.browser, knowledge_path),
                    json=knowledge_body,
                )
                assert denied.status_code == 404
                knowledge = await client.post(
                    knowledge_path,
                    headers=await context(owner, knowledge_path),
                    json=knowledge_body,
                )
                assert knowledge.status_code == 200, knowledge.text
                knowledge = knowledge.json()
                update_path = f"{knowledge_path}/{knowledge['id']}"
                add_path = f"{update_path}/documents"
                added = await client.post(
                    add_path,
                    headers=await context(owner, add_path),
                    json={"title": "New document", "expected_revision": 0},
                )
                assert added.status_code == 200, added.text
                convert_path = "/v1/thought-workshop/markdown/convert"
                converted = await client.post(
                    convert_path,
                    headers=await context(owner, convert_path),
                    json={"markdown": "# Converted heading"},
                )
                assert converted.status_code == 200, converted.text
                assert converted.json()["document"]["content"][0]["type"] == "heading"
                export_path = f"/v1/thought-workshop/notes/{added.json()['id']}/export"
                exported = await client.get(
                    export_path,
                    headers=await context(owner, export_path, "GET"),
                    params={"expected_revision": 0},
                )
                assert exported.status_code == 200, exported.text
                assert exported.text.startswith("# New document")
                search_path = "/v1/thought-workshop/search"
                search_headers = await context(owner, search_path, "GET")
                search = await client.get(
                    search_path,
                    headers=search_headers,
                    params={"knowledge_base_id": knowledge["id"], "query": "New document"},
                )
                assert search.status_code == 200, search.text
                assert search.json()["total"] == 1
                assert search.json()["items"][0]["id"] == added.json()["id"]
                snapshot_path = f"{update_path}/export-snapshot"
                snapshot = await client.get(
                    snapshot_path,
                    headers=await context(owner, snapshot_path, "GET"),
                )
                assert snapshot.status_code == 200, snapshot.text
                assert snapshot.json()["asset_ids"] == [case.asset]
                backup_path = "/v1/thought-workshop/backup"
                backed_up = await client.get(
                    backup_path,
                    headers=await context(owner, backup_path, "GET"),
                    params={"knowledge_base_id": knowledge["id"]},
                )
                assert backed_up.status_code == 200, backed_up.text
                with ZipFile(BytesIO(backed_up.content)) as archive:
                    manifest = json.loads(archive.read("manifest.json"))
                    assert manifest["version"] == 9
                    assert {n["id"] for n in manifest["notes"]} == {
                        knowledge["home_note_id"],
                        added.json()["id"],
                    }
                    assert archive.read("assets/" + case.asset) == (
                        b"\x89PNG\r\n\x1a\nvisible image bytes"
                    )
                favorite_path = "/v1/thought-workshop/community/favorites/official/example"
                favorite = await client.put(
                    favorite_path,
                    headers=await context(owner, favorite_path, "PUT"),
                    json={"favorite": True},
                )
                assert favorite.status_code == 200, favorite.text
                assert favorite.json()["resource_ids"] == ["official/example"]
                permissions = "/v1/thought-workshop/community/publications/pub/permissions"
                settings = await client.get(
                    permissions,
                    headers=await context(owner, permissions, "GET"),
                    params={"note_id": "note"},
                )
                assert settings.status_code == 200, settings.text
                update_permissions = {
                    "articles": [
                        {
                            "note_id": "note",
                            "expected_revision": settings.json()[0]["revision"],
                            "visibility": "members",
                            "members": [{"username": "viewing-user", "role": "edit"}],
                        }
                    ]
                }
                denied = await client.put(
                    permissions,
                    headers=await context(case.browser, permissions, "PUT"),
                    json=update_permissions,
                )
                assert denied.status_code == 404, denied.text
                granted = await client.put(
                    permissions,
                    headers=await context(owner, permissions, "PUT"),
                    json=update_permissions,
                )
                assert granted.status_code == 200, granted.text
                assert granted.json()[0]["members"][0]["role"] == "edit"
                conflict = await client.put(
                    permissions,
                    headers=await context(owner, permissions, "PUT"),
                    json=update_permissions,
                )
                assert conflict.status_code == 409, conflict.text
                update_body = {"title": "Cover removed", "expected_revision": 1}
                denied = await client.put(
                    update_path,
                    headers=await context(case.browser, update_path, "PUT"),
                    json=update_body,
                )
                assert denied.status_code == 404, denied.text
                updated = await client.put(
                    update_path,
                    headers=await context(owner, update_path, "PUT"),
                    json=update_body,
                )
                assert updated.status_code == 200, updated.text
                assert updated.json()["cover_asset_id"] is None
                assert updated.json()["revision"] == 2
                stale = await client.put(
                    update_path,
                    headers=await context(owner, update_path, "PUT"),
                    json=update_body,
                )
                assert stale.status_code == 409, stale.text
            from fpl_thought.retention import ThoughtReferenceDelivery

            await ThoughtReferenceDelivery(
                app.state.database.sessions, app.state.thought_references.client
            ).process_once()
            async with case.assets.state.database.sessions(
                info={"owner_user_id": case.owner}
            ) as session:
                ref = await session.scalar(
                    select(AssetReferenceSet).where(
                        AssetReferenceSet.resource_kind == "template",
                        AssetReferenceSet.resource_id == template["id"],
                    )
                )
                assert ref is not None and ref.resource_revision == 0
                pins = list(
                    await session.scalars(
                        select(AssetReferencePin).where(
                            AssetReferencePin.reference_set_id == ref.id
                        )
                    )
                )
                assert [pin.asset_id for pin in pins] == [case.asset]
                note_ref = await session.scalar(
                    select(AssetReferenceSet).where(
                        AssetReferenceSet.resource_kind == "note",
                        AssetReferenceSet.resource_id == note["id"],
                    )
                )
                assert note_ref is not None and note_ref.resource_revision == 0
                note_pins = list(
                    await session.scalars(
                        select(AssetReferencePin).where(
                            AssetReferencePin.reference_set_id == note_ref.id
                        )
                    )
                )
                assert [pin.asset_id for pin in note_pins] == [case.asset]
                table_ref = await session.scalar(
                    select(AssetReferenceSet).where(
                        AssetReferenceSet.resource_kind == "note",
                        AssetReferenceSet.resource_id == table_note["id"],
                    )
                )
                assert table_ref is not None and table_ref.resource_revision == 0
                table_pins = list(
                    await session.scalars(
                        select(AssetReferencePin).where(
                            AssetReferencePin.reference_set_id == table_ref.id
                        )
                    )
                )
                assert [pin.asset_id for pin in table_pins] == [case.asset]
                for item, expected in ((direct.json(), [case.asset]), (document.json(), [])):
                    created_ref = await session.scalar(
                        select(AssetReferenceSet).where(
                            AssetReferenceSet.resource_kind == "note",
                            AssetReferenceSet.resource_id == item["id"],
                        )
                    )
                    assert created_ref is not None and created_ref.resource_revision == 0
                    created_pins = list(
                        await session.scalars(
                            select(AssetReferencePin).where(
                                AssetReferencePin.reference_set_id == created_ref.id
                            )
                        )
                    )
                    assert [pin.asset_id for pin in created_pins] == expected
                cover_ref = await session.scalar(
                    select(AssetReferenceSet).where(
                        AssetReferenceSet.resource_kind == "knowledge-base",
                        AssetReferenceSet.resource_id == knowledge["id"],
                    )
                )
                assert cover_ref is not None and cover_ref.resource_revision == 2
                cover_pins = list(
                    await session.scalars(
                        select(AssetReferencePin).where(
                            AssetReferencePin.reference_set_id == cover_ref.id
                        )
                    )
                )
                assert not cover_pins
                home_ref = await session.scalar(
                    select(AssetReferenceSet).where(
                        AssetReferenceSet.resource_kind == "note",
                        AssetReferenceSet.resource_id == knowledge["home_note_id"],
                    )
                )
                assert home_ref is not None and home_ref.resource_revision == 0
                assert not list(
                    await session.scalars(
                        select(AssetReferencePin).where(
                            AssetReferencePin.reference_set_id == home_ref.id
                        )
                    )
                )


def test_template_creation_operation_matches_public_contract():
    import json
    from pathlib import Path

    from fastapi import FastAPI

    from fpl_thought.mutations_http import router

    app = FastAPI()
    app.include_router(router, prefix="/v1")
    expected = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )
    actual = app.openapi()
    path = "/v1/thought-workshop/templates"
    assert actual["paths"][path]["post"] == expected["paths"][path]["post"]


def test_template_apply_operation_matches_public_contract():
    import json
    from pathlib import Path

    from fastapi import FastAPI

    from fpl_thought.mutations_http import router

    app = FastAPI()
    app.include_router(router, prefix="/v1")
    expected = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )
    path = "/v1/thought-workshop/templates/{template_id}/apply"
    assert app.openapi()["paths"][path]["post"] == expected["paths"][path]["post"]


def test_note_creation_operations_match_public_contract():
    import json
    from pathlib import Path

    from fastapi import FastAPI

    from fpl_thought.mutations_http import router

    app = FastAPI()
    app.include_router(router, prefix="/v1")
    expected = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )
    for path in (
        "/v1/thought-workshop/notes",
        "/v1/thought-workshop/knowledge-bases/{project_id}/documents",
    ):
        assert app.openapi()["paths"][path]["post"] == expected["paths"][path]["post"]


def test_knowledge_base_mutations_match_public_contract():
    import json
    from pathlib import Path

    from fastapi import FastAPI

    from fpl_thought.mutations_http import router

    app = FastAPI()
    app.include_router(router, prefix="/v1")
    expected = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )
    path = "/v1/thought-workshop/knowledge-bases"
    assert app.openapi()["paths"][path]["post"] == expected["paths"][path]["post"]
    path += "/{project_id}"
    assert app.openapi()["paths"][path]["put"] == expected["paths"][path]["put"]


def test_account_owned_knowledge_tools_match_public_contract():
    import json
    from pathlib import Path

    from fastapi import FastAPI

    from app.apps.thought_workshop.content_exports_http import router as conversion_router
    from app.apps.thought_workshop.knowledge_tools.http import router

    app = FastAPI()
    app.include_router(router, prefix="/v1/thought-workshop", tags=["thought-workshop"])
    app.include_router(conversion_router, prefix="/v1")
    expected = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )
    operations = app.openapi()["paths"]
    assert len(operations) == 13
    for path, methods in operations.items():
        for method, operation in methods.items():
            assert operation == expected["paths"][path][method]


def test_independent_thought_mounts_shared_routes_with_public_contract(tmp_path):
    from pathlib import Path

    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

    app = create_app(
        state_root=tmp_path,
        catalog=CATALOG,
        public_key=Ed25519PrivateKey.generate().public_key(),
        credential=THOUGHT_SECRET,
        identity=None,
        retention_client=None,
        assets_peer_credential=PEER_SECRET,
        run_worker=False,
    )
    contract = json.loads(
        (Path(__file__).resolve().parents[1] / "web/src/generated/openapi.json").read_text()
    )["paths"]
    actual = app.openapi()["paths"]
    for method, path in (
        ("get", "/backup"),
        ("get", "/link-preview"),
        ("get", "/models"),
        ("post", "/notes/{note_id}/assistant"),
        ("post", "/notes/{note_id}/multitable/conversion-preview"),
        ("post", "/notes/{note_id}/multitable/csv-preview"),
        ("post", "/notes/{note_id}/multitable/tables/{table_id}/csv-export"),
        ("get", "/notes/{note_id}/external-sync"),
        ("delete", "/notes/{note_id}/external-sync/binding"),
        ("get", "/notes/{note_id}/external-sync/tasks/{task_id}"),
        ("put", "/community/favorites/{namespace}/{resource_id}"),
        ("get", "/community/official-import/preview"),
        ("get", "/community/official-import/{request_id}"),
        ("get", "/community/official-links/{library_key}"),
        ("get", "/community/publications/{publication_id}/management"),
        ("put", "/community/publications/{publication_id}/permissions"),
        ("post", "/community/publications/{publication_id}/references"),
        (
            "post",
            "/community/publications/{publication_id}/notes/{note_id}/multitable/conversion-preview",
        ),
    ):
        path = "/v1/thought-workshop" + path
        assert actual[path][method] == contract[path][method], (method, path)
