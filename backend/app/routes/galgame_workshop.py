from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, File, HTTPException, Query, UploadFile

from app.core.config import get_settings
from app.deps import SessionDep
from app.files import AssetError
from app.galgame_workshop.assets import GalgameProjectAssets
from app.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameStoryNotReadyError,
    GalgameWorkshopProjectNotFoundError,
)
from app.galgame_workshop.projects import (
    GalgameWorkshopProjects,
)
from app.galgame_workshop.story import GalgameStoryDocuments
from app.schemas.galgame_workshop import (
    GalgameProjectAssetListOut,
    GalgameProjectAssetOut,
    GalgameStoryDocumentOut,
    GalgameStoryDocumentPutIn,
    GalgameStoryRouteReportOut,
    GalgameWorkshopProjectCreateIn,
    GalgameWorkshopProjectListOut,
    GalgameWorkshopProjectOut,
    GalgameWorkshopProjectPatchIn,
)

router = APIRouter(prefix="/galgame-workshop/projects", tags=["galgame-workshop"])


def _not_found(
    exc: GalgameWorkshopProjectNotFoundError | GalgameStoryDocumentNotFoundError,
) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


def _invalid_story(exc: GalgameStoryDocumentInvalidError) -> HTTPException:
    return HTTPException(422, {"code": "invalid_story_document", "message": str(exc)})


@router.get("", response_model=GalgameWorkshopProjectListOut)
async def list_projects(session: SessionDep) -> GalgameWorkshopProjectListOut:
    return await GalgameWorkshopProjects(session).list()


@router.post("", response_model=GalgameWorkshopProjectOut)
async def create_project(
    session: SessionDep,
    body: GalgameWorkshopProjectCreateIn,
) -> GalgameWorkshopProjectOut:
    return await GalgameWorkshopProjects(session).create(body)


@router.get("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def get_project(session: SessionDep, project_id: str) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).get(project_id)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.get("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def get_story(session: SessionDep, project_id: str) -> GalgameStoryDocumentOut:
    try:
        return await GalgameStoryDocuments(session).get(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.put("/{project_id}/story", response_model=GalgameStoryDocumentOut)
async def put_story(
    session: SessionDep,
    project_id: str,
    body: GalgameStoryDocumentPutIn,
) -> GalgameStoryDocumentOut:
    try:
        return await GalgameStoryDocuments(session).put(project_id, body)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.get("/{project_id}/assets", response_model=GalgameProjectAssetListOut)
async def list_project_assets(
    session: SessionDep,
    project_id: str,
    query: str = Query(default="", max_length=255),
) -> GalgameProjectAssetListOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).list(
            project_id, query=query.strip()
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None


@router.post("/{project_id}/assets", response_model=GalgameProjectAssetOut)
async def upload_project_asset(
    session: SessionDep,
    project_id: str,
    upload: Annotated[UploadFile, File()],
) -> GalgameProjectAssetOut:
    try:
        return await GalgameProjectAssets(session, get_settings()).upload(project_id, upload)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


@router.delete("/{project_id}/assets/{asset_id}")
async def delete_project_asset(
    session: SessionDep,
    project_id: str,
    asset_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameProjectAssets(session, get_settings()).delete(
            project_id, asset_id, expected_revision
        )
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except AssetError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    return {"deleted": True}


@router.get("/{project_id}/story/report", response_model=GalgameStoryRouteReportOut)
async def get_story_report(session: SessionDep, project_id: str) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameStoryDocuments(session).report(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None


@router.patch("/{project_id}", response_model=GalgameWorkshopProjectOut)
async def patch_project(
    session: SessionDep,
    project_id: str,
    body: GalgameWorkshopProjectPatchIn,
) -> GalgameWorkshopProjectOut:
    try:
        return await GalgameWorkshopProjects(session).patch(project_id, body)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    except GalgameStoryNotReadyError as exc:
        raise HTTPException(
            422,
            {
                "code": "story_not_ready",
                "message": str(exc),
                "report": exc.report.model_dump(mode="json"),
            },
        ) from None


@router.delete("/{project_id}")
async def delete_project(
    session: SessionDep,
    project_id: str,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    try:
        await GalgameWorkshopProjects(session).delete(project_id, expected_revision)
    except GalgameWorkshopProjectNotFoundError as exc:
        raise _not_found(exc) from None
    return {"deleted": True}
