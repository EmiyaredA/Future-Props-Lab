"""Expose the live state of only the exact dispatched review to Agent Runtime."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.apps.visual_workshop.acceptance.models import AcceptanceRun
from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.visual_agent_review import STATUS, AgentReviewPlan, status_target

from .review_dispatch_records import VisualReviewDispatch

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
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as db:
        run = await db.get(AcceptanceRun, run_id)
        dispatch = await db.get(VisualReviewDispatch, run_id)
        plan = dispatch.executor.get("agent_plan") if dispatch is not None else None
        return {
            "active": bool(
                run is not None
                and run.project_id == project_id
                and run.status == "processing"
                and plan is not None
                and AgentReviewPlan.model_validate(plan).digest == digest
            )
        }
