"""Map shared project errors without loading any business router."""

from fastapi import HTTPException

from studio.runtime.project_errors import ProjectResourceError


async def resolve(action):
    try:
        return await action
    except ProjectResourceError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
