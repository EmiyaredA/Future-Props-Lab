"""Check conversation data and reference delivery at the Visual service boundary."""

import io

import pytest
from fastapi import UploadFile
from sqlalchemy import select

from studio.apps.asset_library.references.references import AssetReferences
from studio.apps.asset_library.storage.service_models import AssetReferencePin, AssetReferenceSet
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
)
from studio.contracts.asset_library.references import ReferenceUpdate
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.visual_workshop.visual_assistant import (
    ASSET_PURPOSE,
    AttachmentQuery,
)
from studio.runtime.http.capability_client import CapabilityDenied
from tests.apps.thought_workshop.test_community_asset_protocol import (  # noqa: F401
    ASSETS_SECRET,
    CATALOG,
    scenario,
)
from tests.integration.test_independent_project_catalog import authorize


async def verify_conversations(case, visual, http):
    base = "/v1/visual-workshop/projects/own/conversations"

    async def request(method, path, **kwargs):
        headers = await authorize(case, "visual", method, path.split("?")[0])
        return await http.request(method, path, headers=headers, **kwargs)

    assert (await request("GET", base)).json() == {"items": []}
    options = (await request("GET", base + "/models")).json()["items"]
    assert {item["slug"] for item in options} == {"text-own", "vision-own"}
    response = await request("POST", base)
    assert response.status_code == 200, response.text
    created = response.json()
    conversation = created["id"]
    path = base + "/" + conversation
    assert created["model_slug"] in {"text-own", "vision-own"}
    assert created["messages"] == []
    assert (await request("GET", base)).json()["items"][0]["id"] == conversation
    foreign = path.replace("/own/", "/foreign/")
    assert (await request("GET", foreign)).status_code == 404
    assert (
        await request("PATCH", path, json={"expected_revision": 0, "model_id": "foreign-model"})
    ).json()["code"] == "model_unavailable"
    await visual.state.reference_delivery.process_once()
    attachments = case.assets.state.database
    async with attachments.sessions(info={"owner_user_id": case.viewer}) as session:
        asset = await AssetLibrary(session, case.assets.state.settings).store_upload(
            UploadFile(io.BytesIO(b"example attachment"), filename="attached.txt"),
            owner_user_id=case.viewer,
        )
        asset_id = asset.id
    # Reproduce the migration projection for a previously saved attachment.
    await AssetReferences(attachments).replace(
        owner=case.viewer,
        service="visual",
        update=ReferenceUpdate(
            request_id="historical-assistant-attachment",
            resource_kind="conversation",
            resource_id=conversation,
            resource_revision=0,
            expected_revision=2,
            asset_ids=[asset_id],
        ),
    )
    async with visual.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
        message = VisualAssistantMessage(
            id="old-message",
            conversation_id=conversation,
            position=0,
            turn_id="old-turn",
            role="assistant",
            content="history",
            status="completed",
        )
        db.add(message)
        await db.flush()
        db.add(VisualAssistantMessageAsset(message_id=message.id, asset_id=asset_id, position=0))
        db.add(
            VisualAssistantAction(
                message_id=message.id,
                action_id="action",
                run_id="old-run",
                position=0,
                tool_name="canvas_summary",
                effect="read",
                status="completed",
            )
        )
        await db.commit()
    response = await request("GET", path)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["messages"][0]["assets"] == [
        {"id": asset_id, "display_name": "attached", "mime_type": "text/plain", "byte_size": 18}
    ]
    assert result["messages"][0]["actions"][0]["tool_name"] == "canvas_summary"
    query = AttachmentQuery(asset_ids=[asset_id])
    original = (await authorize(case, "visual", "GET", path))[HEADER]
    client = visual.state.capabilities
    with pytest.raises(CapabilityDenied):
        await client.authorize_request(
            original,
            RequestGrant(
                "visual",
                ASSET_PURPOSE,
                "GET",
                path,
                "assets",
                "POST",
                query.path("foreign", conversation),
            ),
        )
    target = query.path("own", conversation)
    delegated = await client.authorize_request(
        original, RequestGrant("visual", ASSET_PURPOSE, "GET", path, "assets", "POST", target)
    )
    changed = await http.post(
        "http://assets:8080" + target, headers={HEADER: delegated}, json={"asset_ids": [case.asset]}
    )
    assert changed.status_code == 403
    patched = await request("PATCH", path, json={"expected_revision": 0, "title": "renamed"})
    assert patched.status_code == 200, patched.text
    assert patched.json()["title"] == "renamed" and patched.json()["revision"] == 1
    conflict = await request("DELETE", path + "?expected_revision=0")
    assert conflict.status_code == 409, conflict.text
    assert conflict.json()["current"] == patched.json()
    deleted = await request("DELETE", path + "?expected_revision=1")
    assert deleted.status_code == 200 and deleted.json() == {"deleted": True}
    assert (await request("GET", path)).status_code == 404
    await visual.state.reference_delivery.recover()
    await visual.state.reference_delivery.process_once()
    async with attachments.sessions(info={"owner_user_id": case.viewer}) as db:
        projection = await db.scalar(
            select(AssetReferenceSet).where(
                AssetReferenceSet.resource_kind == "conversation",
                AssetReferenceSet.resource_id == conversation,
            )
        )
        assert projection.deleted and projection.resource_revision == 2
        assert await db.get(AssetReferencePin, (projection.id, asset_id)) is None
