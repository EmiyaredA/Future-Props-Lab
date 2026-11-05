from typing import Annotated

from fastapi import APIRouter, Path, Request

from studio.assembly.http_dependencies import OwnerDep
from studio.contracts.tools.navigation import (
    ToolFavoriteIn,
    ToolNavigationItemOut,
    ToolNavigationStateOut,
)

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
async def get_state(request: Request, owner: OwnerDep) -> ToolNavigationStateOut:
    return await request.app.state.tool_navigation.list(owner=owner)


@router.patch("/tools/{tool_id}", response_model=ToolNavigationItemOut)
async def set_favorite(
    request: Request, owner: OwnerDep, tool_id: ToolId, body: ToolFavoriteIn
) -> ToolNavigationItemOut:
    return await request.app.state.tool_navigation.set_favorite(
        owner=owner, tool_id=tool_id, is_favorite=body.is_favorite
    )


@router.post("/tools/{tool_id}/use", response_model=ToolNavigationItemOut)
async def record_use(request: Request, owner: OwnerDep, tool_id: ToolId) -> ToolNavigationItemOut:
    return await request.app.state.tool_navigation.record_use(owner=owner, tool_id=tool_id)
