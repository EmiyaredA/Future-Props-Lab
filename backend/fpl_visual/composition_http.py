"""Published Visual composition and retry operations."""

from fastapi import APIRouter, Request

from app.apps.visual_workshop.generation_common import GenerationError
from app.apps.visual_workshop.generation_routes import generation_error
from app.apps.visual_workshop.schemas.generation import GenerationBatchOut, ImageCompositionCreateIn
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .compositions import Compositions

router = APIRouter(prefix="/v1/visual-workshop", tags=["visual-generation"])


@router.post("/projects/{project_id}/image-compositions", response_model=GenerationBatchOut)
async def create_image_composition(
    request: Request,
    session: SessionDep,
    owner: OwnerDep,
    project_id: str,
    body: ImageCompositionCreateIn,
):
    try:
        return await Compositions(request, session, owner).create(project_id, body)
    except GenerationError as exc:
        raise generation_error(exc) from None


@router.post("/generation-batches/{batch_id}/retry-composition", response_model=GenerationBatchOut)
async def retry_image_composition(
    request: Request, session: SessionDep, owner: OwnerDep, batch_id: str
):
    try:
        return await Compositions(request, session, owner).retry(batch_id)
    except GenerationError as exc:
        raise generation_error(exc) from None
