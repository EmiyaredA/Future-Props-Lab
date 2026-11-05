"""Release only private account media authorized for a signed Annotation request."""

from typing import Annotated

import jwt
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.annotation_assets import (
    MAX_AUDIO_BYTES,
    MAX_IDS,
    PREFIX,
    AudioAssetDescription,
    AudioAssetQuery,
)
from fpl_runtime.claims import HEADER, verify_context

from ..library_reads import content, describe

router = APIRouter(include_in_schema=False)


def owner(request):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_annotation_assets_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "annotation_assets_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "annotation_assets_authorization_forbidden")
    return actor.user_id


@router.get(PREFIX + "/metadata/{digest}")
async def metadata(
    request: Request, digest: str, id: Annotated[list[str], Query(max_length=MAX_IDS)]
):
    account = owner(request)
    try:
        query = AudioAssetQuery(asset_ids=id)
    except ValidationError:
        raise HTTPException(422, "annotation_assets_query_invalid") from None
    if query.digest != digest:
        raise HTTPException(403, "annotation_assets_query_changed")
    async with request.app.state.database.sessions(info={"owner_user_id": account}) as session:
        result = await describe(
            session, account, query.asset_ids, description=AudioAssetDescription
        )
    return JSONResponse(
        {"items": [result[key].model_dump() for key in query.asset_ids]},
        headers={"Cache-Control": "no-store"},
    )


@router.get(PREFIX + "/content/{asset_id}/{revision}")
async def file_content(request: Request, asset_id: str, revision: int):
    account = owner(request)
    async with request.app.state.database.sessions(info={"owner_user_id": account}) as session:
        description, path = await content(
            session, request.app.state.settings, account, asset_id, revision
        )
    if description.media_kind != "audio":
        raise HTTPException(422, {"code": "invalid_audio", "message": "标注任务只能使用音频文件"})
    if description.byte_size > MAX_AUDIO_BYTES:
        raise HTTPException(413, {"code": "audio_too_large", "message": "音频不能超过 100 MiB"})
    return FileResponse(
        path,
        media_type=description.mime_type,
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Fpl-File-Revision": str(description.revision),
        },
    )
