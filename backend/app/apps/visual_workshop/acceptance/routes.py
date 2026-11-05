from fastapi import APIRouter

from app.apps.visual_workshop.acceptance.reviews import Reviews
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceRepairOut,
    AcceptanceRepairWriteIn,
    AcceptanceRunOut,
    AcceptanceSampleIn,
)
from app.apps.visual_workshop.acceptance.standards import Standards
from app.deps import OwnerDep, SessionDep
from app.llm.schemas.visual_catalog import AcceptanceModelListOut
from app.llm.visual_catalog import acceptance_models

from .http_errors import errors
from .node_routes import router as node_router

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/projects/{project_id}/acceptance/models", response_model=AcceptanceModelListOut)
async def list_acceptance_models(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    with errors():
        await Standards(session, owner_user_id).get(project_id)
        return await acceptance_models(session, owner_user_id)


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
