"""Stream the requested signed Motion or Video project originals in scope order."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from studio.apps.asset_library.motion.motion_files import versioned_files
from studio.apps.asset_library.video.video_files import versioned_files as video_files
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_exports import render_target
from studio.contracts.motion_compositor.motion_preview import (
    INPUTS,
    MAX_SCOPE_BYTES,
    FrameScope,
    preview_target,
)
from studio.contracts.video_editor.video_frames import INPUTS as VIDEO_INPUTS
from studio.contracts.video_editor.video_frames import target as video_target
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)


@router.post(VIDEO_INPUTS + "/{project_id}/{digest}")
@router.post(INPUTS + "/{project_id}/{digest}")
async def originals(request: Request, project_id: str, digest: str):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_motion_preview_required")
    target = request.headers.get("X-Fpl-Render-Target", "")
    video = request.url.path.startswith(VIDEO_INPUTS + "/")
    export = None if video else render_target("POST", target)
    preview = video_target("POST", target) if video else preview_target("POST", target)
    match = (
        (export[1], export[4])
        if export
        else (preview[1], preview[5] if video else preview[3])
        if preview
        else None
    )
    if match != (project_id, digest):
        raise HTTPException(403, "motion_preview_scope_mismatch")
    state = request.app.state
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="rendering",
            method="POST",
            path=target,
            public_key=state.identity_public_key,
            allow_expired=bool(export),
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_preview_authorization_required") from None
    permission = "content.write" if export else "content.read"
    if actor.purpose != "studio" or permission not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_preview_forbidden")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_SCOPE_BYTES:
            raise HTTPException(413, "motion_preview_scope_too_large")
        raw.extend(chunk)
    try:
        scope = FrameScope.model_validate_json(bytes(raw))
    except ValidationError:
        raise HTTPException(422, "motion_preview_scope_invalid") from None
    if scope.digest != digest:
        raise HTTPException(403, "motion_preview_scope_mismatch")
    if export:
        active = await state.identity.motion_export_source_status(
            assertion=request.headers[HEADER], path=target
        )
        if active is None:
            raise HTTPException(503, "identity_unavailable")
        if not active:
            raise HTTPException(401, "motion_export_revoked")
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        load_files = video_files if video else versioned_files
        sources = await load_files(session, state.settings, actor.user_id, project_id, scope.files)

    return StreamingResponse(
        stream_files(sources),
        media_type="application/octet-stream",
        headers={"Content-Length": str(content_length(sources))},
    )
