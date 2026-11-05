"""Expose the live state of only the exact dispatched review to Agent Runtime."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.visual_workshop.review.review_agent import active_review
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.visual_workshop.visual_agent_review import STATUS, status_target

router = APIRouter(include_in_schema=False)


@router.get(STATUS + "/{project_id}/{run_id}/{digest}")
async def review_status(request: Request, project_id: str, run_id: str, digest: str):
    path, state = request.url.path, request.app.state
    if not status_target("GET", path) or "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "visual_review_status_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="visual",
            method="GET",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_review_status_grant_required") from None
    permissions = effective_permissions(actor.platform_role, frozenset(actor.scopes))
    if actor.purpose != "studio" or not {"content.write", "models.use"} <= permissions:
        raise HTTPException(403, "visual_review_status_forbidden")
    return {
        "active": await active_review(state.database, actor.user_id, project_id, run_id, digest)
    }
