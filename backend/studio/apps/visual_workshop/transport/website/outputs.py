from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile

from app.capabilities.asset_store import AssetError
from app.deps import OwnerDep, SessionDep
from studio.apps.visual_workshop.canvas import VisualCanvasDocuments
from studio.apps.visual_workshop.outputs.history import NodeOutputs, OutputError
from studio.apps.visual_workshop.outputs.schemas import (
    VisualNodeFinalOutputIn,
    VisualNodeOutputCreateIn,
    VisualNodeOutputListOut,
    VisualNodeOutputOut,
)
from studio.apps.visual_workshop.outputs.uploads import upload_version
from studio.apps.visual_workshop.schemas.workshop import VisualCanvasDocumentOut
from studio.config.settings import get_settings

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


def output_error(exc: OutputError | AssetError):
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


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
        return await NodeOutputs(session, owner_user_id).list(project_id, node_id, page, page_size)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/nodes/{node_id}/outputs", response_model=VisualCanvasDocumentOut)
async def add_node_output(
    project_id: str,
    node_id: str,
    body: VisualNodeOutputCreateIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    try:
        await NodeOutputs(session, owner_user_id).add(project_id, node_id, body)
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/nodes/{node_id}/output-uploads", response_model=VisualCanvasDocumentOut)
async def upload_node_output(
    project_id: str,
    node_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
):
    try:
        await upload_version(
            NodeOutputs(session, owner_user_id),
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
    owner_user_id: OwnerDep,
):
    try:
        await NodeOutputs(session, owner_user_id).select_final(project_id, node_id, body)
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.get("/{project_id}/nodes/{node_id}/outputs/{output_id}", response_model=VisualNodeOutputOut)
async def get_node_output(
    project_id: str, node_id: str, output_id: str, session: SessionDep, owner_user_id: OwnerDep
):
    try:
        return await NodeOutputs(session, owner_user_id).get(project_id, node_id, output_id)
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
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
):
    try:
        await NodeOutputs(session, owner_user_id).delete(
            project_id, node_id, output_id, expected_revision
        )
        return await VisualCanvasDocuments(session).get(project_id)
    except OutputError as exc:
        raise output_error(exc) from None


@router.post("/{project_id}/node-uploads", response_model=VisualCanvasDocumentOut)
async def upload_material_node(
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
    from studio.apps.visual_workshop.canvas import VisualCanvasError
    from studio.apps.visual_workshop.outputs.uploads import upload_material

    try:
        return await upload_material(
            session,
            get_settings(),
            owner_user_id,
            project_id,
            file,
            expected_revision,
            x=x,
            y=y,
            category_id=category_id,
            group=group,
        )
    except (OutputError, AssetError, VisualCanvasError) as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
