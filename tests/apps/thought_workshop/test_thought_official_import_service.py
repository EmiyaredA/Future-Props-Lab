"""An independent official import persists notes, projections and replay receipts."""

import asyncio
from uuid import uuid4

import httpx
import pytest
from sqlalchemy import func, select

from studio.apps.asset_library.clients.retention import RetentionClient
from studio.apps.asset_library.storage.service_models import AssetReferenceSet
from studio.apps.identity.accounts import create_account
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.thought_workshop.official_projections import OfficialProjections
from studio.apps.thought_workshop.retention import ThoughtReferenceDelivery
from studio.assembly.independent.thought_workshop.application import create_app
from studio.contracts.identity.claims import HEADER
from tests.apps.thought_workshop.test_community_asset_protocol import (
    ASSETS_SECRET,
    CATALOG,
    GATEWAY_SECRET,
    PASSWORD,
    PEER_SECRET,
    THOUGHT_SECRET,
    scenario,  # noqa: F401
)


async def test_official_import_replays_and_delivers_empty_projections(scenario):  # noqa: F811
    case = scenario
    async with case.identity.state.database.sessions() as session:
        admin, _ = await create_account(
            session,
            username="package-admin",
            display_name="Package administrator",
            password=PASSWORD,
            platform_role="admin",
        )
        admin_id = admin.id
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    client = RetentionClient(service="thought", credential=THOUGHT_SECRET, transport=case.mesh)
    app = create_app(
        state_root=case.db.root,
        catalog=CATALOG,
        public_key=case.key.public_key(),
        credential=THOUGHT_SECRET,
        identity=LiveAuthorization(
            service="thought", credential=THOUGHT_SECRET, transport=case.mesh
        ),
        retention_client=client,
        assets_peer_credential=PEER_SECRET,
        transport=case.mesh,
        run_worker=False,
    )
    origin = "http://127.0.0.1:19000"
    path = "/v1/thought-workshop/community/official-import"

    async def authorize(browser, method, request_path):
        response = await browser.get(
            "/_internal/v1/authorize",
            headers={
                "X-Fpl-Target-Service": "thought",
                "X-Fpl-Request-Method": method,
                "X-Fpl-Request-Uri": request_path,
                "Origin": origin,
                "X-CSRF-Token": browser.cookies["fpl_csrf"],
            },
        )
        assert response.status_code == 204, response.text
        return {HEADER: response.headers[HEADER]}

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://thought"
        ) as thought,
        httpx.AsyncClient(
            transport=httpx.ASGITransport(app=case.identity),
            base_url=origin,
            headers={
                "X-Fpl-Gateway": GATEWAY_SECRET,
                "X-Fpl-Ingress": "local",
                "X-Fpl-Client-Ip": "127.0.0.1",
            },
        ) as browser,
    ):
        login = await browser.post(
            "/v1/auth/login", json={"username": "package-admin", "password": PASSWORD}
        )
        assert login.status_code == 200, login.text
        preview_path = path + "/preview"
        preview = await thought.get(
            preview_path, headers=await authorize(browser, "GET", preview_path)
        )
        assert preview.status_code == 200, preview.text
        info = preview.json()
        body = {"request_id": str(uuid4()), "package_version": info["package_version"]}
        denied = await thought.post(
            path, headers=await authorize(case.browser, "POST", path), json=body
        )
        assert denied.status_code == 403, denied.text
        imported = await thought.post(
            path, headers=await authorize(browser, "POST", path), json=body
        )
        assert imported.status_code == 200, imported.text
        result = imported.json()
        assert len(result["knowledge_base_ids"]) == info["library_count"]
        assert len(result["note_ids"]) == info["article_count"]
        replayed = await thought.post(
            path, headers=await authorize(browser, "POST", path), json=body
        )
        assert replayed.json() == result

        delivery = ThoughtReferenceDelivery(app.state.database.sessions, client)
        for _ in range(16):
            await delivery.process_once()
        async with case.assets.state.database.sessions(info={"owner_user_id": admin_id}) as session:
            count = await session.scalar(select(func.count()).select_from(AssetReferenceSet))
            assert count == info["library_count"] * 2 + info["article_count"]


async def test_failed_prepare_preserves_successful_batch_entries_for_abort():
    prepared_second = asyncio.Event()
    aborted = []

    class References:
        async def prepare(self, *, change, **_kwargs):
            if change.resource_id == "failure":
                await prepared_second.wait()
                raise ValueError("preparation failed")
            prepared_second.set()
            return change.resource_id

        async def abort_after_rollback(self, _session, reference):
            aborted.append(reference)

    projections = OfficialProjections(
        owner="test",
        identity=None,
        assertion="synthetic",
        source_method="POST",
        source_path="/official-import",
        references=References(),
    )
    with pytest.raises(ValueError, match="preparation failed"):
        await projections.prepare({("note", "failure"): set(), ("note", "prepared"): set()})
    await projections.abort(None)
    assert aborted == ["prepared"]
