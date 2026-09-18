from __future__ import annotations

from fastapi import APIRouter, status

from app.apps.galgame_workshop.assets.annotation_import import GalgameAnnotationImports
from app.apps.galgame_workshop.routes._shared import _asset_error
from app.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
)
from app.capabilities.asset_store import AssetError
from app.deps import SessionDep, WorkspaceDep
from app.runtime.config import get_settings

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
