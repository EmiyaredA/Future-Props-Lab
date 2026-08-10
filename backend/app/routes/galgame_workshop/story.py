from __future__ import annotations

# ruff: noqa: F405
from fastapi import APIRouter

from app.routes.galgame_workshop._shared import *  # noqa: F403
from app.routes.galgame_workshop._shared import _invalid_story, _not_found

router = APIRouter()


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


@router.get("/{project_id}/story/report", response_model=GalgameStoryRouteReportOut)
async def get_story_report(session: SessionDep, project_id: str) -> GalgameStoryRouteReportOut:
    try:
        return await GalgameReadiness(session, get_settings()).report(project_id)
    except (
        GalgameWorkshopProjectNotFoundError,
        GalgameStoryDocumentNotFoundError,
    ) as exc:
        raise _not_found(exc) from None
    except GalgameStoryDocumentInvalidError as exc:
        raise _invalid_story(exc) from None
