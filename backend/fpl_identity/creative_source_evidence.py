"""Issue source-import evidence only to the independently credentialed gateway."""

import base64
import binascii
import secrets
import time

import jwt
from fastapi import APIRouter, HTTPException, Request
from starlette.responses import JSONResponse

from app.capabilities.identity.permissions import role_permissions
from app.capabilities.identity.route_permissions import route_permission
from fpl_runtime.claims import verify_context
from fpl_runtime.creative_source_evidence import SOURCE_PATH, issue_source_evidence, strict_json

from .live import active_actor

router = APIRouter(include_in_schema=False)


@router.post("/_internal/v1/authorization/creative-source-evidence")
async def creative_source_evidence(request: Request):
    options = request.app.state.identity_options
    credentials = options["service_credentials"]
    expected = credentials.get("gateway")
    supplied = request.headers.get("authorization", "").removeprefix("Bearer ")
    forbidden = [value for key, value in credentials.items() if key != "gateway"] + [
        options["gateway_token"],
        options.get("management_gateway_token"),
    ]
    if (
        not isinstance(expected, str)
        or len(expected) < 32
        or not expected.isascii()
        or any(isinstance(value, str) and value == expected for value in forbidden)
        or not supplied.isascii()
        or not secrets.compare_digest(supplied, expected)
    ):
        raise HTTPException(403, "gateway_credential_required")
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(400, "creative_evidence_request_invalid")
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > 32 * 1024:
            raise HTTPException(413, "creative_evidence_request_too_large")
    try:
        body = strict_json(bytes(data))
        if not isinstance(body, dict) or set(body) != {"assertion", "body_base64"}:
            raise ValueError("invalid request")
        assertion, encoded = body["assertion"], body["body_base64"]
        if not isinstance(assertion, str) or len(assertion) > 8192 or not isinstance(encoded, str):
            raise ValueError("invalid fields")
        raw = base64.b64decode(encoded, validate=True)
        key = options["private_key"].public_key()
        actor = verify_context(
            assertion, service="creative", method="POST", path=SOURCE_PATH, public_key=key
        )
        source = jwt.decode(
            assertion,
            key,
            algorithms=["EdDSA"],
            issuer="fpl-identity",
            audience="creative",
            options={"require": ["jti", "exp"]},
        )
        if source["exp"] <= int(time.time()):
            raise ValueError("expired")
        permission = route_permission("POST", SOURCE_PATH)
        if (
            permission is None
            or permission not in role_permissions(actor.platform_role)
            or "studio:write" not in actor.scopes
        ):
            raise HTTPException(403, "creative_source_permission_denied")
        async with request.app.state.database.sessions() as session:
            if not await active_actor(session, actor):
                raise HTTPException(401, "creative_source_authorization_revoked")
        evidence = issue_source_evidence(
            actor=actor,
            request_id=source["jti"],
            raw=raw,
            source_expiry=source["exp"],
            private_key=options["private_key"],
            key_id=options["key_id"],
        )
    except (ValueError, TypeError, binascii.Error, jwt.InvalidTokenError, UnicodeError):
        raise HTTPException(400, "creative_evidence_request_invalid") from None
    return JSONResponse({"evidence": evidence}, headers={"Cache-Control": "no-store"})
