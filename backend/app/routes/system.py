from typing import Annotated

from fastapi import APIRouter, Header
from pydantic import BaseModel

from app.core.config import get_settings
from app.deps import verify_studio_token

router = APIRouter(prefix="/studio", tags=["system"])


class StudioAuthStatus(BaseModel):
    auth_required: bool


@router.get("/auth/check", response_model=StudioAuthStatus)
async def auth_check(
    x_studio_token: Annotated[str | None, Header(alias="X-Studio-Token")] = None,
) -> StudioAuthStatus:
    verify_studio_token(x_studio_token)
    return StudioAuthStatus(auth_required=bool(get_settings().fpl_studio_token.strip()))
