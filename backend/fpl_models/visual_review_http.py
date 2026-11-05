"""Allow an owned Visual node run to use only the fixed acceptance model."""

from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from app.llm.visual_catalog import fixed_acceptance_model
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_review import MODEL_PLAN, MODEL_RUN, ReviewModelRun

from .catalog_reads import owned_catalog
from .visual_review_attempts import plan_for

router = APIRouter(include_in_schema=False)


@router.get(MODEL_PLAN)
async def visual_model_plan(request: Request):
    async with owned_catalog(request, purpose="visual_review_model", permission="models.use") as (
        actor,
        session,
    ):
        pair = await fixed_acceptance_model(session, actor.user_id, request.app.state.settings)
        return plan_for(pair) if pair else None


@router.post(MODEL_RUN + "/{project_id}/{run_id}/{digest}")
async def visual_model_review(request: Request, body: ReviewModelRun):
    if request.url.path != body.path:
        raise HTTPException(403, "visual_review_model_scope_changed")
    async with owned_catalog(request, purpose="visual_review_model", permission="models.use") as (
        actor,
        _session,
    ):
        if "content.write" not in effective_permissions(
            actor.platform_role, frozenset(actor.scopes)
        ):
            raise HTTPException(403, "visual_review_model_scope_forbidden")
        try:
            return await request.app.state.visual_review_attempts.execute(actor, body)
        except ProjectResourceError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
