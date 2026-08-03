from __future__ import annotations

import secrets
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def verify_studio_token(raw: str | None) -> None:
    configured = get_settings().fpl_studio_token.strip()
    if not configured:
        return
    candidate = (raw or "").strip()
    if not candidate or not secrets.compare_digest(candidate, configured):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={"code": "studio_auth_required", "message": "管理令牌无效或已失效"},
            headers={"WWW-Authenticate": "StudioToken"},
        )


async def require_studio_auth(
    x_studio_token: Annotated[str | None, Header(alias="X-Studio-Token")] = None,
) -> None:
    verify_studio_token(x_studio_token)
