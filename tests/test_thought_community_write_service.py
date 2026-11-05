"""Cross-account community writes through actual Thought, Identity and Assets APIs."""

from copy import deepcopy

import httpx
import pytest
from sqlalchemy import select
from tests.test_community_asset_protocol import (
    ASSETS_SECRET,
    scenario,  # noqa: F401
)
from tests.test_thought_archive_import_service import ORIGIN, thought_app

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.storage.service_models import AssetReferencePin, ReferenceIntent
from studio.apps.identity.clients.authorization import LiveAuthorization
from studio.apps.thought_workshop.multitable.storage import initialize, snapshot
from studio.apps.thought_workshop.publication.models import (
    ArticleMember,
    CommunityUpload,
    Publication,
    PublishedArticle,
)
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote
from studio.apps.thought_workshop.storage.retention_records import ThoughtReferenceMutation
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.identity.claims import HEADER

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
        from studio.apps.thought_workshop.retention import ThoughtReferenceDelivery

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


async def setup_table(case, *, embedded):
    await prepare_case(case)
    await change_role(case, "edit")
    async with case.db.sessions(info={"owner_user_id": case.owner}) as session:
        note = await session.get(ThoughtNote, "note")
        note.kind = "multitable"
        note.document = {"type": "doc", "content": [{"type": "paragraph"}]}
        await initialize(session, note)
        state = await snapshot(session, note.id)
        table = state.tables[0].model_dump(mode="json")
        session.add(CommunityUpload(note_id=note.id, asset_id=case.asset, user_id=case.viewer))
        if embedded:
            session.add(
                ThoughtKnowledgeBase(id="parent-book", owner_user_id=case.owner, title="Parent")
            )
            await session.flush()
            session.add_all(
                [
                    ThoughtNote(
                        id="parent-note",
                        owner_user_id=case.owner,
                        knowledge_base_id="parent-book",
                        title="Parent note",
                        kind="note",
                        document={
                            "type": "doc",
                            "content": [
                                {
                                    "type": "multitableView",
                                    "attrs": {
                                        "noteId": "note",
                                        "tableId": table["id"],
                                        "viewId": table["views"][0]["id"],
                                    },
                                }
                            ],
                        },
                        search_text="",
                    ),
                    Publication(
                        id="parent-pub",
                        owner_user_id=case.owner,
                        knowledge_base_id="parent-book",
                        publisher_id=case.owner,
                        title="Parent publication",
                    ),
                ]
            )
            await session.flush()
            session.add(PublishedArticle(publication_id="parent-pub", note_id="parent-note"))
        await session.commit()
    table["fields"].append(
        {"id": "files", "name": "Files", "type": "attachment", "position": len(table["fields"])}
    )
    return table


@pytest.mark.parametrize(("embedded", "revoke"), [(False, False), (True, False), (True, True)])
async def test_community_table_uses_article_owner_and_keeps_attachment_history(
    scenario,  # noqa: F811
    embedded,
    revoke,
):
    case = scenario
    table = await setup_table(case, embedded=embedded)
    transport = RevokeAfterPrepare(case) if revoke else case.mesh
    app = thought_app(case, transport)
    path = (PATH.replace("/pub/", "/parent-pub/") if embedded else PATH) + "/multitable/operations"
    params = {"parent_note_id": "parent-note"} if embedded else {}
    body = {
        "expected_revision": 0,
        "operations": [
            {"op": "table.put", "table": table},
            {
                "op": "records.put",
                "table_id": table["id"],
                "records": [{"id": "row", "position": 0, "values": {"files": [case.asset]}}],
            },
        ],
    }
    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://thought") as c,
    ):
        denied = deepcopy(body)
        denied["operations"][1]["records"][0]["values"]["files"] = ["unpublished-file"]
        result = await c.post(
            path, headers=await authorize(case, "POST", path), json=denied, params=params
        )
        assert result.status_code == 404, result.text
        result = await c.post(
            path, headers=await authorize(case, "POST", path), json=body, params=params
        )
        assert result.status_code == (404 if revoke else 200), result.text
        if not revoke:
            assert result.json()["structure"]["publication_id"] == "pub"
            delete = {
                "expected_revision": 1,
                "operations": [{"op": "records.delete", "table_id": table["id"], "ids": ["row"]}],
            }
            removed = await c.post(
                path, headers=await authorize(case, "POST", path), json=delete, params=params
            )
            assert removed.status_code == 200, removed.text
            assert removed.json()["structure"]["revision"] == 2
        async with app.state.database.sessions(info={"owner_user_id": case.owner}) as session:
            note = await session.get(ThoughtNote, "note")
            assert note.revision == (0 if revoke else 2)
            mutations = list(await session.scalars(select(ThoughtReferenceMutation)))
            assert {mutation.state for mutation in mutations} == {"abort" if revoke else "commit"}
        from studio.apps.thought_workshop.retention import ThoughtReferenceDelivery

        delivery = ThoughtReferenceDelivery(
            app.state.database.sessions, app.state.thought_references.client
        )
        for mutation in sorted(mutations, key=lambda row: row.resource_revision or 0):
            await delivery.deliver(case.owner, mutation.request_id)
        async with case.assets.state.database.sessions(
            info={"owner_user_id": case.owner}
        ) as session:
            assert [row.asset_id for row in await session.scalars(select(AssetReferencePin))] == [
                case.asset
            ]
