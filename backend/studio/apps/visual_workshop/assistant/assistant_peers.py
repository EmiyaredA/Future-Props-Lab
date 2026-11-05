"""Obtain credential-free model labels and exact retained attachment metadata."""

import httpx
from pydantic import TypeAdapter

from studio.apps.visual_workshop.transport.catalog_http import lookup
from studio.contracts.asset_library.references import PrepareReferenceChange
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.contracts.model_service.schemas.visual_catalog import (
    AssistantCatalog,
    GenerationOptionsOut,
)
from studio.contracts.visual_workshop.visual_assistant import (
    ASSET_PURPOSE,
    INPUT_PURPOSE,
    MODEL_PURPOSE,
    MODEL_TARGET,
    AttachmentContext,
    AttachmentInput,
    AttachmentInputQuery,
    AttachmentMetadata,
    AttachmentQuery,
    CanvasAssetContextQuery,
    CanvasAssetSearch,
)
from studio.contracts.visual_workshop.visual_catalog import GENERATION_TARGET
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError

ATTACHMENTS = TypeAdapter(list[AttachmentMetadata])
INPUTS = TypeAdapter(list[AttachmentInput])
CONTEXT = TypeAdapter(list[AttachmentContext])


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

    async def prepare(
        self, session, project_id, conversation_id, expected_revision, request_id, *, retained=()
    ):
        change = PrepareReferenceChange(
            request_id=request_id,
            resource_kind="conversation",
            resource_id=conversation_id,
            expected_resource_revision=expected_revision,
            asset_ids=sorted(retained),
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

    async def input_query(self, project_id, conversation_id, query, projection):
        peer = self.request.app.state.capabilities
        try:
            target = query.path(project_id, conversation_id)
            grant = RequestGrant(
                "visual",
                INPUT_PURPOSE,
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
                timeout=httpx.Timeout(60, connect=5),
            )
            if response.status_code in (401, 403, 404, 409, 413, 422):
                error = response.json()
                raise ProjectResourceError(
                    error.get("title") or "附件输入不可用",
                    error.get("code") or "assistant_asset_unavailable",
                    response.status_code,
                )
            response.raise_for_status()
            rows = projection.validate_json(response.content)
            return rows
        except CapabilityDenied as exc:
            raise ProjectResourceError(
                "附件授权已撤销", "assistant_asset_denied", exc.status
            ) from exc
        except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
            raise ProjectResourceError(
                "附件输入暂不可用", "assistant_asset_unavailable", 503
            ) from exc

    async def search_assets(self, project, conversation, query: CanvasAssetSearch):
        return await self.input_query(project, conversation, query, CONTEXT)

    async def generation_options(self):
        return await lookup(self.request, GENERATION_TARGET, GenerationOptionsOut)

    async def input_assets(self, project_id, conversation_id, asset_ids):
        return await self.project_inputs(
            project_id,
            conversation_id,
            asset_ids,
            AttachmentInputQuery,
            INPUTS,
            batch_size=5,
            exact=True,
        )

    async def canvas_context(self, project_id, conversation_id, asset_ids):
        return await self.project_inputs(
            project_id,
            conversation_id,
            asset_ids,
            CanvasAssetContextQuery,
            CONTEXT,
            batch_size=64,
            exact=False,
        )

    async def project_inputs(
        self, project_id, conversation_id, asset_ids, query, projection, *, batch_size, exact
    ):
        result = {}
        identities = sorted(set(asset_ids))
        for start in range(0, len(identities), batch_size):
            query_batch = query(asset_ids=identities[start : start + batch_size])
            rows = await self.input_query(project_id, conversation_id, query_batch, projection)
            actual = [row.id for row in rows]
            if (
                actual != sorted(set(actual))
                or not set(actual).issubset(query_batch.asset_ids)
                or (exact and actual != query_batch.asset_ids)
            ):
                raise ProjectResourceError(
                    "附件投影不符合已授权的集合", "assistant_asset_unavailable", 503
                )
            result.update((row.id, row) for row in rows)
        return result
