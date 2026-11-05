"""Private project-owner entry for the exact signed certification command."""

import jwt
from fastapi import APIRouter, HTTPException, Request

from studio.apps.identity.clients.certification import CertificationRejected
from studio.contracts.identity.certification import (
    PREFIX,
    ConfirmedCertification,
    verify_certification,
)
from studio.contracts.identity.errors import AccountError
from studio.runtime.http.account_errors import error_detail
from studio.runtime.http.capability_client import CapabilityUnavailable

router = APIRouter(prefix=PREFIX, include_in_schema=False)


@router.post("/apply", response_model=ConfirmedCertification)
async def apply(request: Request):
    state = request.app.state
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "certification_private_only")
    token = request.headers.get("authorization", "").removeprefix("Bearer ")
    if not 1 <= len(token) <= 8192:
        raise HTTPException(401, "certification_authority_required")
    try:
        grant = verify_certification(
            token, public_key=state.identity_public_key, allow_expired=True
        )
        if grant.command.kind != state.project_certifications.service:
            raise ValueError("wrong project certification owner")
    except (jwt.InvalidTokenError, ValueError, TypeError, KeyError):
        raise HTTPException(401, "certification_authority_required") from None
    try:
        return await state.project_certifications.apply(token, grant)
    except AccountError as exc:
        status, detail = error_detail(exc)
        raise HTTPException(status, detail) from None
    except CertificationRejected as exc:
        raise HTTPException(exc.status, exc.detail) from None
    except CapabilityUnavailable:
        raise HTTPException(503, "project_certification_unconfirmed") from None
