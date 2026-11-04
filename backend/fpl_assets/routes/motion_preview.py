"""Stream a signed frame's exact project originals in canonical scope order."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.motion_preview import INPUTS, MAX_SCOPE_BYTES, SIZE, FrameScope, preview_target

from ..motion_files import frame_files

router = APIRouter(include_in_schema=False)


@router.post(INPUTS + "/{project_id}/{digest}")
async def originals(request: Request, project_id: str, digest: str):
    if "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_motion_preview_required")
    target = request.headers.get("X-Fpl-Render-Target", "")
    match = preview_target("POST", target)
    if not match or (match[1], match[3]) != (project_id, digest):
        raise HTTPException(403, "motion_preview_scope_mismatch")
    state = request.app.state
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="rendering",
            method="POST",
            path=target,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_preview_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
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
    async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
        sources = await frame_files(session, state.settings, actor.user_id, project_id, scope.files)

    def chunks():
        for path, size in sources:
            yield SIZE.pack(size)
            with path.open("rb") as handle:
                while chunk := handle.read(1024 * 1024):
                    yield chunk

    return StreamingResponse(
        chunks(),
        media_type="application/octet-stream",
        headers={"Content-Length": str(sum(SIZE.size + size for _, size in sources))},
    )
