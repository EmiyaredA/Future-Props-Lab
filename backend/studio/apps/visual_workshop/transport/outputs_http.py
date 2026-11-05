"""Published reads for Visual-owned node outputs."""

from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile

from studio.apps.visual_workshop.canvas_documents import VisualCanvasError
from studio.apps.visual_workshop.canvas_writes import PREFIX
from studio.apps.visual_workshop.outputs.queries import OutputError, OutputQueries
from studio.apps.visual_workshop.outputs.schemas import (
    VisualNodeFinalOutputIn,
    VisualNodeOutputCreateIn,
    VisualNodeOutputListOut,
    VisualNodeOutputOut,
)
from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentOut
from studio.apps.visual_workshop.transport.projects_http import canvas_writes
from studio.apps.visual_workshop.uploads import Uploads
from studio.runtime.http.dependencies import OwnerDep, SessionDep

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


@router.post("/{project_id}/nodes/{node_id}/outputs", response_model=VisualCanvasDocumentOut)
async def add_node_output(
    request: Request,
    project_id: str,
    node_id: str,
    body: VisualNodeOutputCreateIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        return await canvas_writes(request, session, owner_user_id).append_output(
            project_id, node_id, body
        )
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.put("/{project_id}/nodes/{node_id}/final-output", response_model=VisualCanvasDocumentOut)
async def set_node_final_output(
    request: Request,
    project_id: str,
    node_id: str,
    body: VisualNodeFinalOutputIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        return await canvas_writes(request, session, owner_user_id).select_final_output(
            project_id, node_id, body
        )
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.delete(
    "/{project_id}/nodes/{node_id}/outputs/{output_id}", response_model=VisualCanvasDocumentOut
)
async def delete_node_output(
    request: Request,
    project_id: str,
    node_id: str,
    output_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    try:
        return await canvas_writes(request, session, owner_user_id).delete_output(
            project_id, node_id, output_id, expected_revision
        )
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/{project_id}/nodes/{node_id}/output-uploads", response_model=VisualCanvasDocumentOut)
async def upload_node_output(
    request: Request,
    project_id: str,
    node_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
):
    try:
        return await Uploads.from_request(request, session, owner_user_id).output(
            project_id, node_id, file, expected_revision
        )
    except OutputError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.post("/{project_id}/node-uploads", response_model=VisualCanvasDocumentOut)
async def upload_material_node(
    request: Request,
    project_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
    x: Annotated[float, Form()] = 0,
    y: Annotated[float, Form()] = 0,
    category_id: Annotated[str | None, Form(max_length=64)] = None,
    group: Annotated[str | None, Form(max_length=120)] = None,
):
    try:
        return await Uploads.from_request(request, session, owner_user_id).material(
            project_id, file, expected_revision, x, y, category_id, group
        )
    except (OutputError, VisualCanvasError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
