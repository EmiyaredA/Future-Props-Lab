"""Thought request sessions receive an explicit Identity account-directory port."""

import inspect
from typing import Annotated

from fastapi import Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.website.account_directory import DirectoryBindings
from studio.apps.thought_workshop.website.asset_metadata import AssetMetadataBindings
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
    assets = getattr(request.app.state, "thought_assets", None)
    if isinstance(assets, AssetMetadataBindings):
        asset_port = assets.for_request(request, session, principal)
        if inspect.isawaitable(asset_port):
            asset_port = await asset_port

        def asset_metadata_for_owner(_session, owner):
            if owner != principal.user_id:
                raise ThoughtError("素材账号上下文不匹配", 403, "asset_context_mismatch")
            return asset_port

        session.info["thought_asset_metadata_factory"] = asset_metadata_for_owner
    session.info["thought_directory"] = directory
    return session


async def thought_session(request: Request, session: BaseSessionDep, principal: StudioAuth):
    return await bind_ports(request, session, principal)


async def community_session(request: Request, session: BaseSessionDep, principal: PublicStudioAuth):
    return await bind_ports(request, session, principal)


SessionDep = Annotated[AsyncSession, Depends(thought_session)]
CommunitySessionDep = Annotated[AsyncSession, Depends(community_session)]
