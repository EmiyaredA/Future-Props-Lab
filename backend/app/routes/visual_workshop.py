from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.core.config import get_settings
from app.deps import SessionDep
from app.schemas.visual_workshop import (
    VisualAssetOut,
    VisualAssetReferenceCreateIn,
    VisualAssetReferencePatchIn,
    VisualCanvasDocumentOut,
    VisualCanvasDocumentPutIn,
    VisualWorkshopProjectCreateIn,
    VisualWorkshopProjectListOut,
    VisualWorkshopProjectOut,
    VisualWorkshopProjectPatchIn,
)
from app.visual_workshop.assets import AssetError, VisualAssets
from app.visual_workshop.canvas import VisualCanvasDocuments, VisualCanvasError
from app.visual_workshop.projects import (
    VisualWorkshopProjectNotFoundError,
    VisualWorkshopProjects,
)

router = APIRouter(prefix="/visual-workshop/projects", tags=["visual-workshop"])


def _not_found(exc: VisualWorkshopProjectNotFoundError) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


def _asset_error(exc: AssetError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


def _canvas_error(exc: VisualCanvasError) -> HTTPException:
    return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})


@router.get("", response_model=VisualWorkshopProjectListOut)
async def list_projects(session: SessionDep) -> VisualWorkshopProjectListOut:
    return await VisualWorkshopProjects(session).list()


@router.post("", response_model=VisualWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    body: VisualWorkshopProjectCreateIn,
) -> VisualWorkshopProjectOut:
    return await VisualWorkshopProjects(session).create(body)


@router.get("/{project_id}", response_model=VisualWorkshopProjectOut)
async def get_project(session: SessionDep, project_id: str) -> VisualWorkshopProjectOut:
    try:
        return await VisualWorkshopProjects(session).get(project_id)
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def get_canvas(session: SessionDep, project_id: str) -> VisualCanvasDocumentOut:
    try:
        return await VisualCanvasDocuments(session).get(project_id)
    except VisualCanvasError as exc:
        raise _canvas_error(exc) from None


@router.put("/{project_id}/canvas", response_model=VisualCanvasDocumentOut)
async def put_canvas(
    session: SessionDep,
    project_id: str,
    body: VisualCanvasDocumentPutIn,
) -> VisualCanvasDocumentOut:
    try:
        return await VisualCanvasDocuments(session).put(project_id, body)
    except VisualCanvasError as exc:
        raise _canvas_error(exc) from None


@router.patch("/{project_id}", response_model=VisualWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    project_id: str,
    body: VisualWorkshopProjectPatchIn,
) -> VisualWorkshopProjectOut:
    try:
        return await VisualWorkshopProjects(session).patch(project_id, body)
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualWorkshopProjects(session).delete(project_id, expected_revision)
    except VisualWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}


@router.post("/{project_id}/asset-references", response_model=VisualAssetOut)
async def create_asset_reference(
    session: SessionDep,
    project_id: str,
    body: VisualAssetReferenceCreateIn,
) -> VisualAssetOut:
    try:
        return await VisualAssets(session, get_settings()).create_reference(project_id, body)
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.patch("/{project_id}/asset-references/{reference_id}", response_model=VisualAssetOut)
async def patch_asset_reference(
    session: SessionDep,
    project_id: str,
    reference_id: str,
    body: VisualAssetReferencePatchIn,
) -> VisualAssetOut:
    try:
        return await VisualAssets(session, get_settings()).patch_reference(
            project_id, reference_id, body
        )
    except AssetError as exc:
        raise _asset_error(exc) from None


@router.delete("/{project_id}/asset-references/{reference_id}")
async def delete_asset_reference(
    session: SessionDep,
    project_id: str,
    reference_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await VisualAssets(session, get_settings()).delete_reference(
            project_id, reference_id, expected_revision
        )
    except AssetError as exc:
        raise _asset_error(exc) from None
    return {"deleted": True}
