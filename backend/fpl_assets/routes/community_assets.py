"""One private community asset read after live Identity and Thought checks."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import FileResponse

from fpl_runtime.community_assets import verify_community_asset

from ..thought_library import content, describe

router = APIRouter(prefix="/_internal/v1/thought-community-assets", include_in_schema=False)


@router.get("/content")
async def content_for_community(request: Request):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "community_asset_private_only")
    authorization = request.headers.get("authorization", "")
    token = authorization[7:] if authorization.startswith("Bearer ") else ""
    if not 1 <= len(token) <= 16384:
        raise HTTPException(401, "community_asset_authority_required")
    try:
        _actor, source = verify_community_asset(
            token, public_key=request.app.state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "community_asset_authority_invalid") from None
    checks = getattr(request.app.state, "community_asset_checks", None)
    if checks is None:
        raise HTTPException(503, "community_asset_verification_unavailable")
    if not await checks.verify(token):
        raise HTTPException(404, "community_asset_not_found")
    # Recheck the short TTL after all network waits, immediately before selecting
    # source-owned bytes. Both checks are required on every access.
    try:
        _actor, source = verify_community_asset(
            token, public_key=request.app.state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "community_asset_authority_invalid") from None
    evidence = source.evidence
    async with request.app.state.database.sessions(
        info={"owner_user_id": evidence.source_owner_id}
    ) as session:
        metadata = await describe(session, evidence.source_owner_id, {evidence.asset_id})
        description, path = await content(
            session,
            request.app.state.settings,
            evidence.source_owner_id,
            evidence.asset_id,
            metadata[evidence.asset_id].revision,
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
