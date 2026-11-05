"""Authenticate digest-bound, credential-free Visual attachment reads."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_assistant import (
    ASSET_PREFIX,
    INPUT_PREFIX,
    AttachmentContext,
    AttachmentInput,
    AttachmentInputQuery,
    AttachmentMetadata,
    AttachmentQuery,
    CanvasAssetContextQuery,
    CanvasAssetSearch,
    attachment_target,
    input_target,
)

from ..conversation_files import (
    attachment_inputs,
    attachments,
    canvas_attachment_context,
    search_canvas_assets,
)

router = APIRouter(include_in_schema=False)


@router.post(
    ASSET_PREFIX + "/{project_id}/{conversation_id}/{digest}",
    response_model=list[AttachmentMetadata],
)
async def read_attachments(
    request: Request, project_id: str, conversation_id: str, digest: str, body: AttachmentQuery
):
    path = request.url.path
    if not attachment_target("POST", path) or body.digest != digest:
        raise HTTPException(403, "private_conversation_attachment_query_required")
    owner = await owner_for(request)
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return await attachments(session, project_id, conversation_id, body.asset_ids)


@router.post(
    INPUT_PREFIX + "/{project_id}/{conversation_id}/{digest}",
    response_model=list[AttachmentInput],
)
async def read_inputs(
    request: Request, project_id: str, conversation_id: str, digest: str, body: AttachmentInputQuery
):
    if not input_target("POST", request.url.path) or body.digest != digest:
        raise HTTPException(403, "private_conversation_attachment_query_required")
    owner = await owner_for(request)
    return await attachment_inputs(
        request.app.state, owner, project_id, conversation_id, body.asset_ids
    )


@router.post(
    INPUT_PREFIX + "/{project_id}/{conversation_id}/context/{digest}",
    response_model=list[AttachmentContext],
)
async def read_canvas_context(
    request: Request,
    project_id: str,
    conversation_id: str,
    digest: str,
    body: CanvasAssetContextQuery,
):
    if (
        not input_target("POST", request.url.path)
        or body.digest != digest
        or request.url.path != body.path(project_id, conversation_id)
    ):
        raise HTTPException(403, "private_conversation_attachment_query_required")
    owner = await owner_for(request)
    return await canvas_attachment_context(
        request.app.state.database, owner, project_id, body.asset_ids
    )


@router.post(
    INPUT_PREFIX + "/{project_id}/{conversation_id}/search/{digest}",
    response_model=list[AttachmentContext],
)
async def search_project_assets(
    request: Request,
    project_id: str,
    conversation_id: str,
    digest: str,
    body: CanvasAssetSearch,
):
    if (
        not input_target("POST", request.url.path)
        or digest != body.digest
        or request.url.path != body.path(project_id, conversation_id)
    ):
        raise HTTPException(403, "private_conversation_attachment_query_required")
    owner = await owner_for(request)
    return await search_canvas_assets(request.app.state.database, owner, project_id, body)


async def owner_for(request):
    path = request.url.path
    if "cookie" in request.headers or "origin" in request.headers:
        raise HTTPException(403, "private_conversation_attachment_query_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "conversation_attachment_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "conversation_attachment_authorization_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(
            401 if active is False else 503, "conversation_attachment_authority_ended"
        )
    return actor.user_id
