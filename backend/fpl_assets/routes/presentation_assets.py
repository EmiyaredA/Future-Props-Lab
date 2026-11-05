"""Account-library read operations issued only for Presentation requests."""

from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.presentation_assets import MAX_IDS, PREFIX, PresentationAsset, PresentationQuery

from ..library_reads import content, describe

router = APIRouter(include_in_schema=False)


def owner(request):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_presentation_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "presentation_assets_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "presentation_assets_authorization_forbidden")
    return actor.user_id


@router.get(PREFIX + "/metadata/{digest}")
async def metadata(
    request: Request, digest: str, id: Annotated[list[str], Query(max_length=MAX_IDS)]
):
    account = owner(request)
    try:
        query = PresentationQuery(asset_ids=id)
    except ValidationError:
        raise HTTPException(422, "presentation_assets_query_invalid") from None
    if query.digest != digest:
        raise HTTPException(403, "presentation_assets_query_changed")
    async with request.app.state.database.sessions(info={"owner_user_id": account}) as session:
        result = await describe(session, account, query.asset_ids, description=PresentationAsset)
    return JSONResponse(
        {"items": [result[key].model_dump() for key in query.asset_ids]},
        headers={"Cache-Control": "no-store"},
    )


async def _content(request, asset_id, revision, *, vector_only):
    account = owner(request)
    async with request.app.state.database.sessions(info={"owner_user_id": account}) as session:
        description, path = await content(
            session, request.app.state.settings, account, asset_id, revision
        )
    if vector_only and description.mime_type != "image/svg+xml":
        raise HTTPException(422, "presentation_vector_required")
    if description.media_kind not in {"image", "audio", "video"}:
        raise HTTPException(422, "presentation_media_required")
    return FileResponse(
        path,
        media_type=description.mime_type,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Fpl-File-Revision": str(description.revision),
        },
    )


@router.get(PREFIX + "/content/{asset_id}/{revision}")
async def file_content(request: Request, asset_id: str, revision: int):
    return await _content(request, asset_id, revision, vector_only=True)


@router.get(PREFIX + "/export/{asset_id}/{revision}")
async def export_content(request: Request, asset_id: str, revision: int):
    return await _content(request, asset_id, revision, vector_only=False)
