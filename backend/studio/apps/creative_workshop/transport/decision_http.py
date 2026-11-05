"""Private decisions for a specifically authenticated Integrations peer."""

import secrets
from dataclasses import asdict

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from starlette.responses import JSONResponse

from studio.apps.creative_workshop.install_authorization import (
    InstallAuthorizationDenied,
    InstallSource,
)
from studio.contracts.creative_workshop.creative_source_evidence import strict_json
from studio.contracts.creative_workshop.creative_transport import CreativeDecisionRequest

router = APIRouter(include_in_schema=False)
MAX_DECISION_BYTES = 2 * 1024 * 1024


class InstallDecisionEndpoint:
    def __init__(self, *, peer_credential, authority):
        if (
            not isinstance(peer_credential, str)
            or not peer_credential.isascii()
            or len(peer_credential) < 32
        ):
            raise ValueError("Integrations decision credential is invalid")
        self.peer_credential, self.authority = peer_credential, authority


@router.post("/_internal/v1/creative-install/decision")
async def decision(request: Request):
    endpoint = getattr(request.app.state, "creative_install_decisions", None)
    if not isinstance(endpoint, InstallDecisionEndpoint):
        raise HTTPException(503, "creative_decision_unavailable")
    supplied = request.headers.get("authorization", "")
    expected = "Bearer " + endpoint.peer_credential
    if (
        request.headers.get("origin")
        or request.headers.get("cookie")
        or not supplied.isascii()
        or not secrets.compare_digest(supplied, expected)
    ):
        raise HTTPException(403, "creative_decision_peer_required")
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_DECISION_BYTES:
            raise HTTPException(413, "creative_decision_too_large")
    try:
        payload = CreativeDecisionRequest.model_validate(strict_json(bytes(body)))
        source = InstallSource(
            payload.source.assertion, payload.source.evidence, payload.source.body()
        )
        grant = await endpoint.authority.authorize(payload.action, source, payload.batch)
    except (ValueError, TypeError, ValidationError, InstallAuthorizationDenied):
        raise HTTPException(403, "creative_decision_denied") from None
    return JSONResponse(asdict(grant), headers={"Cache-Control": "no-store"})
