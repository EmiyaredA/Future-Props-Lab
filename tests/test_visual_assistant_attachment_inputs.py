"""Check scoped assistant content projections and aborted attachment retention."""

import base64
from types import SimpleNamespace
from uuid import uuid4

import pytest
from tests.test_community_asset_protocol import scenario  # noqa: F401
from tests.test_independent_project_catalog import authorize
from tests.test_visual_compositions_service import png
from tests.test_visual_node_review_service import review_mesh

from app.capabilities.agents.harness import ToolExecutionContext
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.visual_assistant import (
    INPUT_PURPOSE,
    SOURCE,
    AttachmentInputQuery,
    CanvasAssetSearch,
    approval_path,
)
from fpl_visual.assistant_canvas_actions import AssistantCanvasActions


async def test_visual_assistant_reads_only_prepared_project_attachments(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    async with review_mesh(case, tmp_path) as (visual, send, _faults), visual() as app:

        async def create_project():
            created = await send(
                "POST", SOURCE, json={"title": "Assistant media", "kind": "canvas"}
            )
            assert created.status_code == 200, created.text
            await app.state.reference_delivery.process_once()
            return created.json()["id"]

        async def upload(project, name, data, mime):
            reply = await send(
                "POST",
                "/v1/files",
                service="assets",
                data={"project_id": project},
                files={"upload": (name, data, mime)},
            )
            assert reply.status_code == 200, reply.text
            return reply.json()["id"]

        project = await create_project()
        another = await create_project()
        original_image = png("red")
        image = await upload(project, "reference.png", original_image, "image/png")
        document = await upload(project, "spec.md", "待分析文本".encode(), "text/markdown")
        forbidden = await upload(another, "private.png", original_image, "image/png")
        base = f"{SOURCE}/{project}/conversations"
        created = await send("POST", base)
        assert created.status_code == 200, created.text
        conversation = created.json()["id"]
        await app.state.reference_delivery.process_once()
        source = f"{base}/{conversation}/messages/stream"
        assertion = (await authorize(case, "visual", "POST", source))[HEADER]
        references = app.state.reference_mutations
        capability = app.state.capabilities

        async def prepare(change):
            return await references.prepare(
                owner=case.viewer,
                assertion=assertion,
                source_method="POST",
                source_path=source,
                change=change,
            )

        async def inputs(query):
            target = query.path(project, conversation)
            token = await capability.authorize_request(
                assertion,
                RequestGrant("visual", INPUT_PURPOSE, "POST", source, "assets", "POST", target),
            )
            return await capability.client.post(
                "http://assets" + target, headers={HEADER: token}, json=query.model_dump()
            )

        response = await inputs(CanvasAssetSearch())
        assert response.status_code == 200, response.text
        assert {row["id"] for row in response.json()} == {image, document}
        response = await inputs(CanvasAssetSearch(kind="image", query="reference"))
        assert response.status_code == 200, response.text
        assert [row["id"] for row in response.json()] == [image]
        with pytest.raises(CapabilityDenied):
            await capability.authorize_request(
                assertion,
                RequestGrant(
                    "visual",
                    INPUT_PURPOSE,
                    "POST",
                    source,
                    "assets",
                    "POST",
                    CanvasAssetSearch().path(another, conversation),
                ),
            )

        async with app.state.database.sessions(info={"owner_user_id": case.viewer}) as db:
            rejected = PrepareReferenceChange(
                request_id=uuid4().hex,
                resource_kind="conversation",
                resource_id=conversation,
                expected_resource_revision=0,
                asset_ids=[forbidden],
                visual_conversation_project=project,
            )
            with pytest.raises(CapabilityDenied) as invalid:
                await prepare(rejected)
            assert invalid.value.status == 404
            await references.abandon_preparation(db, case.viewer, rejected)
            await app.state.reference_delivery.process_once()
            valid = rejected.model_copy(
                update={"request_id": uuid4().hex, "asset_ids": sorted([image, document])}
            )
            prepared = await prepare(valid)
            query = AttachmentInputQuery(asset_ids=[image, document])
            response = await inputs(query)
            assert response.status_code == 200, response.text
            rows = {row["id"]: row for row in response.json()}
            assert rows[document]["text"] == "待分析文本"
            assert rows[document]["warning"] is None
            assert base64.b64decode(rows[image]["image"]["data_base64"]) == original_image
            assert (await inputs(AttachmentInputQuery(asset_ids=[forbidden]))).status_code == 422
            await references.abort_after_rollback(db, prepared)
            await app.state.reference_delivery.process_once()
            assert (await inputs(query)).status_code == 422


async def test_canvas_tools_only_write_the_approved_project_revision(
    scenario,  # noqa: F811
    tmp_path,
):
    case = scenario
    async with review_mesh(case, tmp_path) as (visual, send, _faults), visual() as app:
        reply = await send("POST", SOURCE, json={"title": "Approved Canvas", "kind": "canvas"})
        assert reply.status_code == 200, reply.text
        project = reply.json()["id"]
        await app.state.reference_delivery.process_once()
        root = f"{SOURCE}/{project}/conversations"
        reply = await send("POST", root)
        assert reply.status_code == 200, reply.text
        conversation = reply.json()["id"]
        run_id, approval_id = uuid4().hex, uuid4().hex
        path = approval_path(project, conversation, run_id, approval_id)
        headers = await authorize(case, "visual", "POST", path)
        action = AssistantCanvasActions(
            app.state,
            SimpleNamespace(
                owner=case.viewer,
                scope=SimpleNamespace(
                    project_id=project, conversation_id=conversation, run_id=run_id
                ),
            ),
        )
        context = ToolExecutionContext(
            run_id,
            "edit",
            {},
            approved_canvas_revision=0,
            approval_id=approval_id,
            approval_authorization=headers[HEADER],
        )
        arguments = {
            "operations": [
                {
                    "op": "add",
                    "node": {
                        "id": "approved-node",
                        "kind": "text",
                        "title": "Approved edit",
                        "position": {"x": 0, "y": 0},
                    },
                }
            ]
        }
        forbidden = await action.apply_canvas_changes(
            arguments,
            ToolExecutionContext(run_id, "edit", {}),
        )
        assert forbidden.error_code == "approval_not_found"
        updated = await action.apply_canvas_changes(arguments, context)
        assert updated.success, updated.model_text
        assert updated.data["canvas_revision"] == 1
        assert updated.data["nodes"][0]["id"] == "approved-node"
        stale = await action.apply_canvas_changes(arguments, context)
        assert stale.error_code == "canvas_conflict"
        assert stale.data["canvas_revision"] == 1
