"""Published reads for Visual-owned node outputs."""

from fastapi import APIRouter, HTTPException, Query

from app.apps.visual_workshop.outputs.queries import OutputError, OutputQueries
from app.apps.visual_workshop.outputs.schemas import VisualNodeOutputListOut, VisualNodeOutputOut
from fpl_runtime.http_dependencies import OwnerDep, SessionDep

from .canvas_writes import PREFIX

router = APIRouter(prefix=PREFIX, tags=["visual-workshop"])


@router.get("/{project_id}/nodes/{node_id}/outputs", response_model=VisualNodeOutputListOut)
async def list_node_outputs(
    project_id: str,
    node_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    try:
        return await OutputQueries(session, owner_user_id).list(
            project_id, node_id, page, page_size
        )
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.get("/{project_id}/nodes/{node_id}/outputs/{output_id}", response_model=VisualNodeOutputOut)
async def get_node_output(
    project_id: str, node_id: str, output_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    try:
        return await OutputQueries(session, owner_user_id).get(project_id, node_id, output_id)
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
