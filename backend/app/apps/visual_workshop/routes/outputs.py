from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.apps.visual_workshop.canvas import VisualCanvasDocuments
from app.apps.visual_workshop.outputs.history import NodeOutputs, OutputError
from app.apps.visual_workshop.outputs.schemas import (
    VisualNodeFinalOutputIn,
    VisualNodeOutputCreateIn,
    VisualNodeOutputListOut,
    VisualNodeOutputOut,
)
from app.apps.visual_workshop.outputs.uploads import upload_version
from app.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentOut
from app.capabilities.asset_store import AssetError
from app.deps import SessionDep, WorkspaceDep
from app.runtime.config import get_settings

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


def output_error(exc: OutputError | AssetError):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("/{project_id}/nodes/{node_id}/outputs", response_model=VisualNodeOutputListOut)
async def list_node_outputs(
    project_id: str,
    node_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
):
    try:
        return await NodeOutputs(session, workspace_id).list(project_id, node_id, page, page_size)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/nodes/{node_id}/outputs", response_model=VisualCanvasDocumentOut)
async def add_node_output(
    project_id: str,
    node_id: str,
    body: VisualNodeOutputCreateIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    try:
        await NodeOutputs(session, workspace_id).add(project_id, node_id, body)
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/nodes/{node_id}/output-uploads", response_model=VisualCanvasDocumentOut)
async def upload_node_output(
    project_id: str,
    node_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
):
    try:
        await upload_version(
            NodeOutputs(session, workspace_id),
            get_settings(),
            project_id,
            node_id,
            file,
            expected_revision,
        )
        return await VisualCanvasDocuments(session).get(project_id)
    except (OutputError, AssetError) as exc:
        raise output_error(exc) from None


@router.put("/{project_id}/nodes/{node_id}/final-output", response_model=VisualCanvasDocumentOut)
async def set_node_final_output(
    project_id: str,
    node_id: str,
    body: VisualNodeFinalOutputIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    try:
        await NodeOutputs(session, workspace_id).select_final(project_id, node_id, body)
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.get("/{project_id}/nodes/{node_id}/outputs/{output_id}", response_model=VisualNodeOutputOut)
async def get_node_output(
    project_id: str, node_id: str, output_id: str, session: SessionDep, workspace_id: WorkspaceDep
):
    try:
        return await NodeOutputs(session, workspace_id).get(project_id, node_id, output_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.delete(
    "/{project_id}/nodes/{node_id}/outputs/{output_id}", response_model=VisualCanvasDocumentOut
)
async def delete_node_output(
    project_id: str,
    node_id: str,
    output_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    expected_revision: int = Query(ge=0),
):
    try:
        await NodeOutputs(session, workspace_id).delete(
            project_id, node_id, output_id, expected_revision
        )
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/node-uploads", response_model=VisualCanvasDocumentOut)
async def upload_material_node(
    project_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
    x: Annotated[float, Form()] = 0,
    y: Annotated[float, Form()] = 0,
):
    from app.apps.visual_workshop.canvas import VisualCanvasError
    from app.apps.visual_workshop.outputs.uploads import upload_material

    try:
        return await upload_material(
            session, get_settings(), workspace_id, project_id, file, expected_revision, x=x, y=y
        )
    except (OutputError, AssetError, VisualCanvasError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
