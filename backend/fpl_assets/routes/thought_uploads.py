"""Private, same-account Thought upload with a digest-bound durable receipt."""

import binascii
import json

import jwt
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.thought_uploads import (
    ThoughtUploadDescription,
    ThoughtUploadReceiptAuthenticator,
    upload_path,
)

from ..thought_uploads import ThoughtUploads
from .library_outputs import OutputStream

router = APIRouter(include_in_schema=False)


@router.post("/_internal/v1/thought-library/uploads/{kind}/{request_id}/{descriptor_sha256}")
async def upload(request: Request, kind: str, request_id: str, descriptor_sha256: str):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_thought_upload_required")
    if request.headers.get("content-encoding", "identity").strip().lower() not in {"", "identity"}:
        raise HTTPException(422, "upload_encoding_forbidden")
    try:
        if request.url.path != upload_path(kind, request_id, descriptor_sha256):
            raise ValueError("invalid upload path")
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "thought_upload_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "thought_upload_forbidden")
    try:
        description = ThoughtUploadDescription.from_header(
            request.headers.get("X-Fpl-Upload-Descriptor", "")
        )
        length = int(request.headers.get("content-length", "-1"))
    except (ValueError, TypeError, binascii.Error, json.JSONDecodeError):
        raise HTTPException(422, "invalid_upload_descriptor") from None
    if (
        description.kind != kind
        or description.fingerprint != descriptor_sha256
        or length != description.byte_size
    ):
        raise HTTPException(422, "upload_descriptor_mismatch")
    if description.byte_size > request.app.state.settings.fpl_visual_asset_max_bytes:
        raise HTTPException(413, "upload_too_large")
    signer = getattr(request.app.state, "thought_upload_results", None)
    if not isinstance(signer, ThoughtUploadReceiptAuthenticator):
        raise HTTPException(503, "thought_upload_receipt_authentication_unavailable")
    nonce = request.headers.get("x-fpl-upload-nonce", "")
    import re

    if not re.fullmatch(r"[a-f0-9]{32}", nonce):
        raise HTTPException(422, "invalid_upload_nonce")

    async def active():
        return await request.app.state.identity.status(
            assertion=request.headers.get(HEADER, ""), method="POST", path=request.url.path
        )

    async with request.app.state.database.sessions(
        info={"owner_user_id": actor.user_id}
    ) as session:
        result = await ThoughtUploads(
            session, request.app.state.settings, actor.user_id, active=active
        ).store(request_id, description, OutputStream(request, description))
    response = JSONResponse(result.model_dump(mode="json"), headers={"Cache-Control": "no-store"})
    response.headers["X-Fpl-Upload-Receipt"] = signer.sign(
        owner=actor.user_id,
        request_id=request_id,
        fingerprint=description.fingerprint,
        nonce=nonce,
        body=response.body,
    )
    return response
