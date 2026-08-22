from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.core.config import get_settings
from app.deps import SessionDep
from app.files import AssetError
from app.galgame_workshop.annotation_import import GalgameAnnotationImports
from app.schemas.galgame_workshop import (
    GalgameAnnotationImportIn,
    GalgameAnnotationImportPreviewOut,
    GalgameAnnotationImportTaskOut,
)

router = APIRouter()


def _error(exc: AssetError) -> HTTPException:
    return HTTPException(
        exc.status,
        {"code": exc.code, "message": str(exc), **exc.detail},
    )


@router.post(
    "/{project_id}/annotation-imports/preview",
    response_model=GalgameAnnotationImportPreviewOut,
)
async def preview_annotation_import(
    session: SessionDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportPreviewOut:
    try:
        return await GalgameAnnotationImports(session, get_settings()).preview(project_id, body)
    except AssetError as exc:
        raise _error(exc) from None


@router.post(
    "/{project_id}/annotation-imports",
    response_model=GalgameAnnotationImportTaskOut,
    status_code=status.HTTP_202_ACCEPTED,
)
async def create_annotation_import(
    session: SessionDep,
    project_id: str,
    body: GalgameAnnotationImportIn,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await GalgameAnnotationImports(session, get_settings()).create(project_id, body)
    except AssetError as exc:
        raise _error(exc) from None


@router.get(
    "/{project_id}/annotation-imports/{import_id}",
    response_model=GalgameAnnotationImportTaskOut,
)
async def get_annotation_import(
    session: SessionDep,
    project_id: str,
    import_id: str,
) -> GalgameAnnotationImportTaskOut:
    try:
        return await GalgameAnnotationImports(session, get_settings()).get(project_id, import_id)
    except AssetError as exc:
        raise _error(exc) from None
