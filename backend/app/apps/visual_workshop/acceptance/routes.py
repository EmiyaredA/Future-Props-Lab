from fastapi import APIRouter, Query

from app.apps.visual_workshop.acceptance.reviews import Reviews, repair_out
from app.apps.visual_workshop.acceptance.runs import Runs, review_models
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceDecisionIn,
    AcceptanceModelListOut,
    AcceptanceModelOut,
    AcceptanceRepairOut,
    AcceptanceRepairWriteIn,
    AcceptanceRunListOut,
    AcceptanceRunOut,
    AcceptanceSampleIn,
)
from app.apps.visual_workshop.acceptance.standards import Standards
from app.deps import OwnerDep, SessionDep, StudioAuth

from .http_errors import errors
from .node_routes import router as node_router

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/projects/{project_id}/acceptance/models", response_model=AcceptanceModelListOut)
async def list_acceptance_models(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    with errors():
        await Standards(session, owner_user_id).get(project_id)
        return AcceptanceModelListOut(
            items=[
                AcceptanceModelOut(
                    id=model.id,
                    label=model.label or model.slug,
                    slug=model.slug,
                    provider_name=provider.name,
                    provider_kind=provider.kind,
                )
                for model, provider in await review_models(session, owner_user_id)
            ]
        )


@router.get("/projects/{project_id}/acceptance/runs", response_model=AcceptanceRunListOut)
async def list_acceptance_runs(
    project_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    node_id: str | None = None,
    page: int = Query(1, ge=1),
):
    with errors():
        return await Runs(session, owner_user_id).list(project_id, node_id, page)


@router.get("/projects/{project_id}/acceptance/runs/{run_id}", response_model=AcceptanceRunOut)
async def get_acceptance_run(
    project_id: str, run_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    with errors():
        return await Runs(session, owner_user_id).get(project_id, run_id)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/decisions", response_model=AcceptanceRunOut
)
async def decide_acceptance_run(
    project_id: str,
    run_id: str,
    body: AcceptanceDecisionIn,
    session: SessionDep,
    principal: StudioAuth,
):
    with errors():
        return await Reviews(session, principal.owner_user_id).decide(
            project_id, run_id, body, principal.user_id
        )


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/cancel", response_model=AcceptanceRunOut
)
async def cancel_acceptance_run(
    project_id: str,
    run_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    with errors():
        return await Runs(session, owner_user_id).cancel(project_id, run_id, expected_revision)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/samples", response_model=AcceptanceRunOut
)
async def sample_acceptance_video(
    project_id: str,
    run_id: str,
    body: AcceptanceSampleIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    with errors():
        return await Reviews(session, owner_user_id).sample(project_id, run_id, body)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts",
    response_model=AcceptanceRepairOut,
)
async def create_acceptance_repair(
    project_id: str, run_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    with errors():
        return await Reviews(session, owner_user_id).repair(project_id, run_id)


@router.get(
    "/projects/{project_id}/acceptance/repair-drafts/{draft_id}", response_model=AcceptanceRepairOut
)
async def get_acceptance_repair(
    project_id: str, draft_id: str, session: SessionDep, owner_user_id: OwnerDep
):

    with errors():
        return repair_out(await Reviews(session, owner_user_id).repair_row(project_id, draft_id))


@router.put(
    "/projects/{project_id}/acceptance/repair-drafts/{draft_id}", response_model=AcceptanceRepairOut
)
async def save_acceptance_repair(
    project_id: str,
    draft_id: str,
    body: AcceptanceRepairWriteIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    with errors():
        return await Reviews(session, owner_user_id).write_repair(project_id, draft_id, body)


router.include_router(node_router)
