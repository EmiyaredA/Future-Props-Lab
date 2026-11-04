"""Export one actor's Integration snapshot for an attested Creative import."""

from dataclasses import replace

import jwt
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from app.integrations.creative_sources import IntegrationCreativeSources
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.creative_source_evidence import SOURCE_TRANSFER, verify_source_request
from fpl_runtime.creative_source_snapshot import CreativeSourcePayload
from fpl_runtime.creative_transport import CreativeAttestedRequest

router = APIRouter(include_in_schema=False)


@router.post(SOURCE_TRANSFER + "{kind}/{source_id}/{checksum}")
async def source(
    request: Request, kind: str, source_id: str, checksum: str, body: CreativeAttestedRequest
):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "creative_source_forbidden")
    path = request.url.path
    token = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            token,
            service="integrations",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
        original, proof = verify_source_request(
            body.assertion, body.evidence, body.body(), public_key=state.identity_public_key
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "creative_source_forbidden") from None
    if (
        actor != replace(original, local=False)
        or (proof.kind, proof.source_id, proof.body_sha256) != (kind, source_id, checksum)
        or actor.purpose != "studio"
        or "configuration.manage"
        not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "creative_source_forbidden")
    if not await state.identity.active(assertion=token, method="POST", path=path):
        raise HTTPException(403, "creative_source_authorization_revoked")
    try:
        async with state.database.sessions(info={"owner_user_id": actor.user_id}) as session:
            snapshot = await IntegrationCreativeSources(session, settings=state.settings).snapshot(
                owner=actor.user_id, kind=kind, source_id=source_id
            )
    except (OSError, ValueError):
        raise HTTPException(422, "creative_source_unavailable") from None
    if not await state.identity.active(assertion=token, method="POST", path=path):
        raise HTTPException(403, "creative_source_authorization_revoked")
    if snapshot is None:
        raise HTTPException(404, "creative_source_not_found")
    return CreativeSourcePayload.model_validate(snapshot)
