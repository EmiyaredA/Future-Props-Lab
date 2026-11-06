"""Thought request sessions receive an explicit Identity account-directory port."""

import inspect
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.website.asset_metadata import AssetMetadata, AssetMetadataBindings
from studio.assembly.http_dependencies import PublicStudioAuth, StudioAuth
from studio.assembly.http_dependencies import SessionDep as BaseSessionDep


async def bind_ports(request, session, principal):
    binding = getattr(request.app.state, "thought_directory", None)
    if not isinstance(binding, DirectoryBindings):
        raise HTTPException(503, {"code": "account_directory_unavailable"})
    directory = binding.for_request(request, session, principal)
    if inspect.isawaitable(directory):
        directory = await directory
    try:
        await directory.current(principal)
        await directory.profiles(ids=(principal.user_id,))
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    session.info["thought_directory"] = directory
    return session


async def request_asset_metadata(request, session, principal):
    """Bind a capability at the protocol boundary; do not discover it from a database session."""
    binding = getattr(request.app.state, "thought_assets", None)
    if not isinstance(binding, AssetMetadataBindings):
        raise ThoughtError("素材目录尚未连接", 503, "asset_metadata_unavailable")
    port = binding.for_request(request, session, principal)
    return await port if inspect.isawaitable(port) else port


async def thought_assets(request: Request, session: BaseSessionDep, principal: StudioAuth):
    try:
        return await request_asset_metadata(request, session, principal)
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None


AssetMetadataDep = Annotated[AssetMetadata, Depends(thought_assets)]


async def thought_session(request: Request, session: BaseSessionDep, principal: StudioAuth):
    return await bind_ports(request, session, principal)


async def community_session(request: Request, session: BaseSessionDep, principal: PublicStudioAuth):
    return await bind_ports(request, session, principal)


SessionDep = Annotated[AsyncSession, Depends(thought_session)]
CommunitySessionDep = Annotated[AsyncSession, Depends(community_session)]
