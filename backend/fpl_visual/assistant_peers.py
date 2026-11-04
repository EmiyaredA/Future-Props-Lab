"""Obtain credential-free model labels and exact retained attachment metadata."""

import httpx
from pydantic import TypeAdapter

from app.llm.schemas.visual_catalog import AssistantCatalog
from fpl_runtime.asset_references import PrepareReferenceChange
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant import (
    ASSET_PURPOSE,
    MODEL_PURPOSE,
    MODEL_TARGET,
    AttachmentMetadata,
    AttachmentQuery,
)

from .catalog_http import lookup

ATTACHMENTS = TypeAdapter(list[AttachmentMetadata])


class AssistantPeers:
    def __init__(self, request, owner):
        self.request = request
        self.owner = owner
        self.assertion = request.state.service_assertion
        self.references = request.app.state.reference_mutations

    async def models(self):
        return await lookup(self.request, MODEL_TARGET, AssistantCatalog, purpose=MODEL_PURPOSE)

    async def attachments(self, project_id, conversation_id, ids):
        if not ids:
            return {}
        peer = self.request.app.state.capabilities
        try:
            query = AttachmentQuery(asset_ids=sorted(ids))
            target = query.path(project_id, conversation_id)
            grant = RequestGrant(
                "visual",
                ASSET_PURPOSE,
                self.request.method,
                self.request.url.path,
                "assets",
                "POST",
                target,
            )
            token = await peer.authorize_request(self.assertion, grant)
            response = await peer.client.post(
                "http://assets:8080" + target,
                headers={HEADER: token},
                json=query.model_dump(),
            )
            if response.status_code in {401, 403}:
                raise CapabilityDenied(response.status_code)
            response.raise_for_status()
            items = ATTACHMENTS.validate_json(response.content)
            if [item.id for item in items] != query.asset_ids:
                raise ValueError("对话素材尚未全部核验")
            return {item.id: item for item in items}
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "素材访问已撤销", "conversation_asset_access_denied", exc.status
            ) from exc
        except (httpx.HTTPError, CapabilityUnavailable, ValueError) as exc:
            raise ProjectResourceError(
                "对话素材暂不可读", "conversation_assets_unavailable", 503
            ) from exc

    async def prepare(self, session, project_id, conversation_id, expected_revision, request_id):
        change = PrepareReferenceChange(
            request_id=request_id,
            resource_kind="conversation",
            resource_id=conversation_id,
            expected_resource_revision=expected_revision,
            asset_ids=[],
            visual_conversation_project=project_id,
        )
        try:
            return await self.references.prepare(
                owner=self.owner,
                assertion=self.assertion,
                source_method=self.request.method,
                source_path=self.request.url.path,
                change=change,
            )
        except CapabilityDenied as exc:
            await self.references.abandon_preparation(session, self.owner, change)
            raise ProjectResourceError(
                "对话素材范围尚未核验",
                "conversation_retention_unavailable",
                503 if exc.status == 409 else exc.status,
            ) from exc
        except CapabilityUnavailable as exc:
            await self.references.abandon_preparation(session, self.owner, change)
            raise ProjectResourceError(
                "对话素材引用结果未确认", "retention_unconfirmed", 503
            ) from exc
