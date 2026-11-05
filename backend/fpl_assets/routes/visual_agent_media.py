"""Bound Assets descriptions and originals for a retained Mac review plan."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.framed_media import content_length, stream_files
from fpl_runtime.library_assets import LibraryAssetDescription
from fpl_runtime.visual_agent_review import SOURCES, AgentReviewPlan, ReviewAssetQuery

from ..visual_agent_media import describe_review_media, review_originals

router = APIRouter(include_in_schema=False)


async def review_media_owner(request, expected):
    path, state = request.url.path, request.app.state
    if path != expected or "cookie" in request.headers or "origin" in request.headers:
        raise HTTPException(403, "visual_agent_media_scope_changed")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_agent_media_grant_required") from None
    permissions = effective_permissions(actor.platform_role, frozenset(actor.scopes))
    if actor.purpose != "studio" or not {"content.write", "models.use"} <= permissions:
        raise HTTPException(403, "visual_agent_media_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_agent_media_authority_ended")
    return actor.user_id


@router.post(
    SOURCES + "/{project_id}/{run_id}/describe/{digest}",
    response_model=list[LibraryAssetDescription],
)
async def describe_agent_review(
    request: Request, project_id: str, run_id: str, body: ReviewAssetQuery
):
    owner = await review_media_owner(request, body.path(project_id, run_id))
    async with request.app.state.database.sessions(info={"owner_user_id": owner}) as session:
        return await describe_review_media(session, project_id, run_id, body.asset_ids)


@router.post(SOURCES + "/{project_id}/{run_id}/originals/{digest}")
async def stream_agent_review(request: Request, body: AgentReviewPlan):
    owner = await review_media_owner(request, body.media_path)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        files = await review_originals(session, state.settings, body)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            "Cache-Control": "private, no-store",
        },
    )
