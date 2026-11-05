from __future__ import annotations

from fastapi import APIRouter, status

from app.capabilities.asset_store import AssetError
from app.deps import OwnerDep, SessionDep
from studio.apps.galgame_workshop.assets.annotation_import import GalgameAnnotationImports
from studio.apps.galgame_workshop.schemas import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
)
from studio.apps.galgame_workshop.transport.website._shared import _asset_error
from studio.config.settings import get_settings

router = APIRouter()


def _imports(session: SessionDep, owner_user_id: str) -> GalgameAnnotationImports:
    return GalgameAnnotationImports(session, owner_user_id, get_settings())


@router.post(
    "/{project_id}/annotation-imports/preview",
    response_model=GalgameAnnotationImportPreviewOut,
)
async def preview_annotation_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportPreviewOut:
    try:
        return await _imports(session, owner_user_id).preview(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.post(
    "/{project_id}/annotation-imports",
    response_model=GalgameAnnotationImportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_annotation_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await _imports(session, owner_user_id).create(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.get(
    "/{project_id}/annotation-imports/{import_id}",
    response_model=GalgameAnnotationImportTaskOut,
)
async def get_annotation_import(
    session: SessionDep,
    owner_user_id: OwnerDep,
    project_id: str,
    import_id: str,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await _imports(session, owner_user_id).get(project_id, import_id)
    except AssetError as exc:
        raise _asset_error(exc) from None
