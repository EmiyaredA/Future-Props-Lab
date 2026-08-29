from __future__ import annotations

from fastapi import APIRouter, status

from app.core.config import get_settings
from app.deps import SessionDep, WorkspaceDep
from app.files import AssetError
from app.galgame_workshop.annotation_import import GalgameAnnotationImports
from app.routes.galgame_workshop._shared import _asset_error
from app.schemas.galgame_workshop import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
)

router = APIRouter()


def _imports(session: SessionDep, workspace_id: str) -> GalgameAnnotationImports:
    return GalgameAnnotationImports(session, workspace_id, get_settings())


@router.post(
    "/{project_id}/annotation-imports/preview",
    response_model=GalgameAnnotationImportPreviewOut,
)
async def preview_annotation_import(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportPreviewOut:
    try:
        return await _imports(session, workspace_id).preview(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/annotation-imports",
    response_model=GalgameAnnotationImportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_annotation_import(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await _imports(session, workspace_id).create(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/annotation-imports/{import_id}",
    response_model=GalgameAnnotationImportTaskOut,
)
async def get_annotation_import(
    session: SessionDep,
    workspace_id: WorkspaceDep,
    project_id: str,
    import_id: str,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await _imports(session, workspace_id).get(project_id, import_id)
    except AssetError as exc:
        raise _asset_error(exc) from None
