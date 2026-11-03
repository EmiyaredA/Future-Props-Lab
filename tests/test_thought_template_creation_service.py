"""Template creation crosses real isolated Identity and Assets services."""

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

    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        book = await session.get(ThoughtKnowledgeBase, "book")
        book.home_note_id = "note"
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

    async def context(browser, source_path=path):
        response = await browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": "POST",
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
