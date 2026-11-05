"""Apply an owned Visual repair without changing its retained asset set."""

from fastapi import APIRouter, HTTPException

from studio.apps.visual_workshop.acceptance.http_errors import errors
from studio.apps.visual_workshop.acceptance.schemas import (
    AcceptanceRepairOut,
    AcceptanceRepairWriteIn,
)
from studio.apps.visual_workshop.canvas_documents import VisualCanvasError
from studio.apps.visual_workshop.canvas_writes import PREFIX
from studio.apps.visual_workshop.review.repair_prompts import write_repair
from studio.runtime.http.dependencies import OwnerDep, SessionDep

router = APIRouter(prefix=PREFIX, tags=["visual-workshop"])


@router.put("/{project_id}/acceptance/repair-drafts/{draft_id}", response_model=AcceptanceRepairOut)
async def save_acceptance_repair(
    project_id: str,
    draft_id: str,
    body: AcceptanceRepairWriteIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    with errors():
        try:
            return await write_repair(session, owner_user_id, project_id, draft_id, body)
        except VisualCanvasError as exc:
            raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
