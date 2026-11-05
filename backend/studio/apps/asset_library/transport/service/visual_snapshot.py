"""Expose Visual snapshot data only under exact, live project assertions."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from studio.apps.asset_library.visual.visual_snapshot_files import metadata, originals
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_snapshot import SnapshotScope
from studio.contracts.visual_workshop.visual_snapshot import (
    ASSETS,
    SnapshotAssetQuery,
    SnapshotFiles,
    asset_target,
)
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)


async def authorize(request, digest, expected):
    path = request.url.path
    if (
        asset_target("POST", path) is None
        or "cookie" in request.headers
        or "origin" in request.headers
        or digest != expected
    ):
        raise HTTPException(403, "visual_snapshot_grant_required")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "visual_snapshot_grant_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_snapshot_access_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_snapshot_authority_ended")
    return actor.user_id


@router.post(ASSETS + "/{project_id}/metadata/{digest}", response_model=SnapshotFiles)
async def visual_metadata(request: Request, project_id: str, digest: str, body: SnapshotAssetQuery):
    owner = await authorize(request, digest, body.digest)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        return await metadata(session, state.settings, project_id, body)


@router.post(ASSETS + "/{project_id}/originals/{digest}")
async def visual_originals(request: Request, project_id: str, digest: str, body: SnapshotScope):
    owner = await authorize(request, digest, body.digest)
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        files = await originals(session, state.settings, project_id, body.files)
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            "Cache-Control": "private, no-store",
        },
    )
