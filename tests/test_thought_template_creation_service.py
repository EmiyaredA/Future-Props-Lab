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

    async def context(browser):
        response = await browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": "POST",
                "X-Fpl-Request-Uri": path,
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
