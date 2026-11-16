from __future__ import annotations

from fastapi import HTTPException

from studio.apps.galgame_workshop.errors import (
    GalgameStoryDocumentInvalidError,
    GalgameStoryDocumentNotFoundError,
    GalgameWorkshopProjectNotFoundError,
)
from studio.contracts.asset_library.errors import AssetError


def _not_found(
    exc: GalgameWorkshopProjectNotFoundError | GalgameStoryDocumentNotFoundError,
) -> HTTPException:
    return HTTPException(404, {"code": "not_found", "message": str(exc)})


def _invalid_story(exc: GalgameStoryDocumentInvalidError) -> HTTPException:
    return HTTPException(422, {"code": "invalid_story_document", "message": str(exc)})


def _asset_error(exc: AssetError) -> HTTPException:
    return HTTPException(
        exc.status,
        {"code": exc.code, "message": str(exc), **exc.detail},
    )
