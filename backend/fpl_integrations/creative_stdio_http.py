"""Apply only the stdio configuration named by the Creative delegation."""

import re
import secrets
import time

import jwt
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.creative_integrations import CreativeOperationGrant, CreativeStdioConfiguration
from fpl_runtime.creative_source_evidence import strict_json
from fpl_runtime.creative_stdio import PRIVATE_STDIO, stdio_target
from fpl_runtime.integration_intents import digest

router = APIRouter(include_in_schema=False)


@router.post(PRIVATE_STDIO + "{installation_id}/{checksum}")
async def stdio(request: Request, installation_id: str, checksum: str):
    state = request.app.state
    verifier = state.creative_authorization
    if verifier is None:
        raise HTTPException(503, "creative_stdio_unavailable")
    authorization = request.headers.get("authorization", "")
    token = request.headers.get(HEADER, "")
    nonce = request.headers.get("x-fpl-creative-nonce", "")
    path = request.url.path
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or not authorization.isascii()
        or not secrets.compare_digest(authorization, "Bearer " + verifier.creative_peer_credential)
        or not re.fullmatch(r"[a-f0-9]{32}", nonce)
        or not stdio_target("POST", path)
    ):
        raise HTTPException(403, "creative_stdio_denied")
    try:
        actor = verify_context(
            token,
            service="integrations",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "creative_stdio_denied") from None
    if actor.purpose != "studio" or "configuration.manage" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "creative_stdio_denied")
    try:
        configuration = CreativeStdioConfiguration.model_validate(strict_json(await request.body()))
    except (ValueError, TypeError):
        raise HTTPException(422, "creative_stdio_configuration_invalid") from None
    signer = verifier.result_authenticator
    if not secrets.compare_digest(checksum, signer.stdio_digest(installation_id, configuration)):
        raise HTTPException(403, "creative_stdio_denied")

    async def authorize():
        active = await state.identity.status(assertion=token, method="POST", path=path)
        if active is None:
            raise HTTPException(503, "creative_stdio_unavailable")
        if not active:
            raise HTTPException(403, "creative_stdio_denied")
        return CreativeOperationGrant(
            actor.user_id,
            "setup",
            configuration.release_id,
            digest(configuration.model_dump(mode="json")),
            int(time.time()) + 5,
        )

    resource = await state.creative_installations.configure_stdio(configuration, authorize)
    response = JSONResponse(resource, headers={"Cache-Control": "no-store"})
    response.headers["X-Fpl-Creative-Result"] = signer.sign(
        action="setup",
        operation=installation_id,
        fingerprint=checksum,
        nonce=nonce,
        status=200,
        body=response.body,
    )
    return response
