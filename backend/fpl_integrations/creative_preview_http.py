"""Accept only a current Integrations assertion for this read-only batch."""

import time

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.creative_integrations import CreativeInstallBatch, CreativeOperationGrant
from fpl_runtime.creative_preview import PRIVATE_PREVIEW, preview_path

router = APIRouter(include_in_schema=False)


@router.post(PRIVATE_PREVIEW + "{checksum}")
async def preview(request: Request, checksum: str, batch: CreativeInstallBatch):
    path = request.url.path
    token = request.headers.get(HEADER, "")
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or preview_path(batch) != path
    ):
        raise HTTPException(403, "creative_preview_denied")
    key = request.app.state.identity_public_key
    try:
        actor = verify_context(
            token, service="integrations", method="POST", path=path, public_key=key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "creative_preview_denied") from None
    if actor.purpose != "studio" or "configuration.manage" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "creative_preview_denied")

    async def authorize():
        active = await request.app.state.identity.status(assertion=token, method="POST", path=path)
        if active is None:
            raise HTTPException(503, "creative_preview_unavailable")
        if not active:
            raise HTTPException(403, "creative_preview_denied")
        return CreativeOperationGrant(
            actor.user_id, "preview", batch.operation_id, checksum, int(time.time()) + 5
        )

    return await request.app.state.creative_installations.preview(batch, authorize)
