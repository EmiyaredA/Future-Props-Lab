"""Handle request-bound Motion-to-Video handoff and replay the original receipt."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from studio.apps.video_editor.errors import (
    VideoEditorNotFoundError,
    VideoEditorUnavailableError,
    VideoEditorValidationError,
)
from studio.apps.video_editor.transport.website.errors import _error
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.video_handoff import HANDOFFS, MotionHandoff, handoff_target

router = APIRouter(include_in_schema=False)


@router.api_route(HANDOFFS + "/{scope:path}", methods=["GET", "POST"])
async def accept(request: Request, scope: str):
    path = f"{HANDOFFS}/{scope}"
    match = handoff_target("POST", path)
    if not match or "cookie" in request.headers or "origin" in request.headers:
        raise HTTPException(403, "private_motion_handoff_required")
    state = request.app.state
    worker = state.motion_handoffs
    if worker is None:
        raise HTTPException(503, "motion_handoff_unavailable")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="video",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
            allow_expired=request.method == "GET",
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_handoff_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_handoff_forbidden")
    active = await state.handoff_identity.status(assertion=token, method="POST", path=path)
    if active is None:
        raise HTTPException(503, "identity_unavailable")
    if not active:
        raise HTTPException(401, "motion_handoff_revoked")
    identity, project, action, digest = match[3], match[4], match[5], match[6]
    try:
        if request.method == "GET":
            return worker.receipt(await worker.load(actor.user_id, identity), path)
        raw = bytearray()
        async for chunk in request.stream():
            if len(raw) + len(chunk) > 4096:
                raise HTTPException(413, "motion_handoff_too_large")
            raw.extend(chunk)
        if sha256(raw) != digest:
            raise HTTPException(403, "motion_handoff_document_changed")
        try:
            source = MotionHandoff.model_validate_json(bytes(raw))
            if (source.new_title is not None) != (action == "new"):
                raise ValueError("invalid handoff mode")
        except (ValidationError, ValueError):
            raise HTTPException(422, "motion_handoff_invalid") from None
        request.state.service_assertion = token
        async with worker.lock(identity):
            await worker.reserve(request, actor.user_id, identity, project, source)
            return worker.receipt(await worker.process(actor.user_id, identity), path)
    except (
        VideoEditorNotFoundError,
        VideoEditorUnavailableError,
        VideoEditorValidationError,
    ) as exc:
        raise _error(exc) from None
