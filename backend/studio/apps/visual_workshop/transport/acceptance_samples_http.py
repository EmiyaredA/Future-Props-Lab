"""The published Visual review video-sampling operation."""

from fastapi import APIRouter, Request

from studio.apps.visual_workshop.acceptance.acceptance_samples import AcceptanceSamples
from studio.apps.visual_workshop.acceptance.http_errors import errors
from studio.apps.visual_workshop.acceptance.schemas import AcceptanceRunOut, AcceptanceSampleIn
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix="/v1/visual-workshop", tags=["visual-workshop"])


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/samples", response_model=AcceptanceRunOut
)
async def sample_acceptance_video(
    request: Request,
    project_id: str,
    run_id: str,
    body: AcceptanceSampleIn,
    session: SessionDep,
    owner: OwnerDep,
):
    with errors():
        return await AcceptanceSamples(request, session, owner).sample(project_id, run_id, body)
