from typing import Annotated

from fastapi import APIRouter, Path

from app.tool_navigation import ToolNavigationState
from app.tool_navigation.schemas import (
    ToolFavoriteIn,
    ToolNavigationItemOut,
    ToolNavigationStateOut,
)
from studio.assembly.http_dependencies import SessionDep

router = APIRouter(prefix="/tool-navigation", tags=["tool-navigation"])

ToolId = Annotated[
    str,
    Path(
        min_length=1,
        max_length=64,
        pattern=r"^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$",
    ),
]


@router.get("/state", response_model=ToolNavigationStateOut)
async def get_state(session: SessionDep) -> ToolNavigationStateOut:
    return await ToolNavigationState(session).list()


@router.patch("/tools/{tool_id}", response_model=ToolNavigationItemOut)
async def set_favorite(
    session: SessionDep, tool_id: ToolId, body: ToolFavoriteIn
) -> ToolNavigationItemOut:
    return await ToolNavigationState(session).set_favorite(tool_id, is_favorite=body.is_favorite)


@router.post("/tools/{tool_id}/use", response_model=ToolNavigationItemOut)
async def record_use(session: SessionDep, tool_id: ToolId) -> ToolNavigationItemOut:
    return await ToolNavigationState(session).record_use(tool_id)
