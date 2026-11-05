"""Authenticate digest-bound, credential-free Visual attachment reads."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_assistant import (
    ASSET_PREFIX,
    AttachmentMetadata,
    AttachmentQuery,
    attachment_target,
)

from ..conversation_files import attachments

router = APIRouter(include_in_schema=False)


@router.post(
    ASSET_PREFIX + "/{project_id}/{conversation_id}/{digest}",
    response_model=list[AttachmentMetadata],
)
async def read_attachments(
    request: Request, project_id: str, conversation_id: str, digest: str, body: AttachmentQuery
):
    path = request.url.path
    if (
        attachment_target("POST", path) is None
        or "cookie" in request.headers
        or "origin" in request.headers
        or body.digest != digest
    ):
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
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        return await attachments(session, project_id, conversation_id, body.asset_ids)
