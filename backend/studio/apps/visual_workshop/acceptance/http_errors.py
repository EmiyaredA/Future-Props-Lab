from contextlib import contextmanager

from fastapi import HTTPException

from studio.apps.visual_workshop.acceptance.project_access import AcceptanceError


@contextmanager
def errors():
    try:
        yield
    except AcceptanceError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
