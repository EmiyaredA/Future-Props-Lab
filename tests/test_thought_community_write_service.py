"""Cross-account community writes through actual Thought, Identity and Assets APIs."""

import httpx
import pytest
from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    scenario,  # noqa: F401
)
from tests.test_thought_archive_import_service import ORIGIN, thought_app

from app.apps.thought_workshop.models import ThoughtNote
from app.apps.thought_workshop.publication.models import ArticleMember
from app.capabilities.asset_store.models import VisualAsset
from fpl_assets.models import AssetReferencePin, ReferenceIntent
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.claims import HEADER
from fpl_runtime.identity_client import LiveAuthorization
from fpl_thought.retention_records import ThoughtReferenceMutation

PATH = "/v1/thought-workshop/community/publications/pub/notes/note"


async def authorize(case, method, path=PATH):
    response = await case.browser.get(
        "/_internal/v1/authorize",
        headers={
            "X-Fpl-Target-Service": "thought",
            "X-Fpl-Request-Method": method,
            "X-Fpl-Request-Uri": path,
            "Origin": ORIGIN,
            "X-CSRF-Token": case.csrf,
        },
    )
    assert response.status_code == 204, response.text
    return {HEADER: response.headers[HEADER]}


async def change_role(case, role):
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        row = await session.get(ArticleMember, ("pub", "note", case.viewer))
        row.role = role
        await session.commit()


async def prepare_case(case):
    case.assets.state.identity = LiveAuthorization(
        service="assets", credential=ASSETS_SECRET, transport=case.mesh
    )
    changes = case.assets.state.reference_changes
    result = await changes.prepare(
        owner=case.owner,
        service="thought",
        change=PrepareReferenceChange(
            request_id="initial-note",
            resource_kind="note",
            resource_id="note",
            expected_resource_revision=-1,
            asset_ids=[case.asset],
        ),
    )
    await changes.commit(
        owner=case.owner, service="thought", intent_id=result["intent_id"], resource_revision=0
    )


class RevokeAfterPrepare(httpx.AsyncBaseTransport):
    def __init__(self, case):
        self.case = case

    async def handle_async_request(self, request):
        response = await self.case.mesh.handle_async_request(request)
        if request.url.host == "assets" and request.url.path == "/_internal/v1/retention/prepare":
            assert response.status_code == 200
            await change_role(self.case, "read")
        return response


def payload(asset_id):
    return {
        "expected_revision": 0,
        "title": "Cross-account edit",
        "document": {"type": "doc", "content": [{"type": "image", "attrs": {"assetId": asset_id}}]},
    }


@pytest.mark.parametrize("revoke", [False, True])
async def test_edit_rechecks_role_and_records_owner_scoped_retention(scenario, revoke):  # noqa: F811
    case = scenario
    await prepare_case(case)
    transport = RevokeAfterPrepare(case) if revoke else case.mesh
    app = thought_app(case, transport)
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://thought") as c,
    ):
        assert (
            await c.put(PATH, headers=await authorize(case, "PUT"), json=payload(case.asset))
        ).status_code == 404
        await change_role(case, "edit")
        denied = await c.put(
            PATH, headers=await authorize(case, "PUT"), json=payload("hidden-file")
        )
        assert denied.status_code == 404, denied.text
        changed = await c.put(PATH, headers=await authorize(case, "PUT"), json=payload(case.asset))
        assert changed.status_code == (404 if revoke else 200), changed.text
        if not revoke:
            assert changed.json()["note"]["revision"] == 1
            assert changed.json()["can_edit"]
            conflict = await c.put(
                PATH, headers=await authorize(case, "PUT"), json=payload(case.asset)
            )
            assert conflict.status_code == 409, conflict.text
        async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            note = await session.get(ThoughtNote, "note")
            assert note.revision == (0 if revoke else 1)
            mutation = (await session.scalars(select(ThoughtReferenceMutation))).one()
            assert mutation.state == ("abort" if revoke else "commit")
            request_id = mutation.request_id
        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as session:
            assert await session.get(ThoughtNote, "note") is None
        from fpl_thought.retention import ThoughtReferenceDelivery

        delivery = ThoughtReferenceDelivery(
            app.state.database.sessions, app.state.thought_references.client
        )
        await delivery.deliver(case.owner, request_id)
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.owner}
        ) as session:
            intent = (
                await session.scalars(
                    select(ReferenceIntent).where(ReferenceIntent.request_id == request_id)
                )
            ).one()
            assert intent.state == ("aborted" if revoke else "committed")
            assert [row.asset_id for row in await session.scalars(select(AssetReferencePin))] == [
                case.asset
            ]
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.viewer}
        ) as session:
            assert await session.get(VisualAsset, case.asset) is None
