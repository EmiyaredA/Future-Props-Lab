"""Map Motion and shared file errors to the published problem details."""

import zipfile

from fastapi import HTTPException

from app.capabilities.asset_store.errors import AssetError
from studio.apps.motion_compositor.projects import MotionInvalid, MotionNotFound, MotionUnavailable


def _error(exc: Exception) -> HTTPException:
    if isinstance(exc, MotionNotFound):
        return HTTPException(404, {"code": "not_found", "message": str(exc)})
    if isinstance(exc, (MotionInvalid, ValueError, zipfile.BadZipFile)):
        return HTTPException(422, {"code": "invalid_motion", "message": str(exc)})
    if isinstance(exc, MotionUnavailable):
        return HTTPException(503, {"code": "motion_unavailable", "message": str(exc)})
    if isinstance(exc, AssetError):
        return HTTPException(exc.status, {"code": exc.code, "message": str(exc)})
    return HTTPException(500, {"code": "motion_error", "message": str(exc)})
