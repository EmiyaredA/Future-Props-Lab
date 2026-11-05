"""Read versioned originals for the exact Visual generation project and task scope."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from studio.apps.asset_library.visual.visual_generation_files import generation_metadata
from studio.apps.asset_library.visual.visual_snapshot_files import originals
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.visual_workshop.visual_generation import (
    ASSETS,
    GenerationAssetQuery,
    GenerationAssets,
    GenerationFileScope,
    generation_asset_target,
)
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)


async def authorize(request, path):
    if (
        request.url.path != path
        or generation_asset_target("POST", path) is None
        or "origin" in request.headers
        or "cookie" in request.headers
    ):
        raise HTTPException(403, "visual_generation_asset_scope_changed")
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token, service="assets", method="POST", path=path, public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_generation_asset_grant_required") from None
    if actor.purpose != "studio" or "models.use" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "visual_generation_asset_forbidden")
    active = await state.identity.status(assertion=token, method="POST", path=path)
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_generation_authority_ended")
    return actor.user_id


@router.post(ASSETS + "/{project_id}/{task_id}/metadata/{digest}", response_model=GenerationAssets)
async def generation_asset_metadata(
    request: Request, project_id: str, task_id: str, body: GenerationAssetQuery
):
    owner = await authorize(request, body.path(project_id, task_id))
    state = request.app.state
    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        return await generation_metadata(session, state.settings, project_id, body.asset_ids)


@router.post(ASSETS + "/{project_id}/{task_id}/originals/{digest}")
async def generation_asset_originals(
    request: Request, project_id: str, task_id: str, body: GenerationFileScope
):
    owner = await authorize(request, body.path(project_id, task_id))
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
