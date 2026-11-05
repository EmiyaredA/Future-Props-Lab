"""Private request-bound library metadata and bytes; public clients cannot choose an owner."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.thought_assets import PREFIX, AssetQuery

from ..library_reads import content, describe

router = APIRouter(include_in_schema=False)


def actor(request):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_thought_library_required")
    try:
        value = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "thought_library_authorization_required") from None
    if value.purpose != "studio" or "content.read" not in effective_permissions(
        value.platform_role, frozenset(value.scopes)
    ):
        raise HTTPException(403, "thought_library_authorization_forbidden")
    return value


@router.post(PREFIX + "/metadata/{digest}")
async def metadata(request: Request, digest: str, body: AssetQuery):
    principal = actor(request)
    if digest != body.digest:
        raise HTTPException(403, "thought_library_query_changed")
    async with request.app.state.database.sessions(
        info={"owner_user_id": principal.user_id}
    ) as session:
        result = await describe(session, principal.user_id, body.asset_ids)
    return JSONResponse(
        {"items": [result[id].model_dump() for id in body.asset_ids]},
        headers={"Cache-Control": "no-store"},
    )


@router.get(PREFIX + "/content/{asset_id}/{revision}")
async def file_content(request: Request, asset_id: str, revision: int):
    principal = actor(request)
    async with request.app.state.database.sessions(
        info={"owner_user_id": principal.user_id}
    ) as session:
        description, path = await content(
            session, request.app.state.settings, principal.user_id, asset_id, revision
        )
        await session.rollback()
    return FileResponse(
        path,
        media_type=description.mime_type,
        filename=description.original_filename,
        content_disposition_type="inline",
        headers={
            "Cache-Control": "no-store",
            "X-Content-Type-Options": "nosniff",
            "X-Fpl-File-Revision": str(description.revision),
        },
    )
