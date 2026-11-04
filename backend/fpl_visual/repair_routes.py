"""Apply an owned Visual repair without changing its retained asset set."""

from fastapi import APIRouter, HTTPException

from app.apps.visual_workshop.acceptance.http_errors import errors
from app.apps.visual_workshop.acceptance.schemas import AcceptanceRepairOut, AcceptanceRepairWriteIn
from app.apps.visual_workshop.canvas_documents import VisualCanvasError
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .canvas_writes import PREFIX
from .repair_prompts import write_repair

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
