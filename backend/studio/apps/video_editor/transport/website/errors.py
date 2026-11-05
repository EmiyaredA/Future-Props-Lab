"""Map Video Editor use cases to their published error response."""

from fastapi import HTTPException

from app.capabilities.asset_store.errors import AssetError
from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, VideoEditorNotFoundError):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, VideoEditorValidationError):
        return HTTPException(422, {"code": exc.code, "message": str(exc)})
    if isinstance(exc, VideoEditorUnavailableError):
        return HTTPException(503, {"code": "video_editor_unavailable", "message": str(exc)})
    if isinstance(exc, AssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc), **exc.detail})
    return HTTPException(500, {"code": "video_editor_error", "message": str(exc)})
