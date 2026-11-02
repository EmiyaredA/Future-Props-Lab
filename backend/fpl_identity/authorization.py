"""Gateway authentication uses existing sessions and fixed business permissions."""

import secrets
from urllib.parse import unquote, urlsplit

from fastapi import APIRouter, HTTPException, Request, Response

from app.capabilities.identity.route_permissions import route_permission
from app.capabilities.identity.session_policy import MANAGEMENT_SESSION, STUDIO_SESSION
from app.console.governance.automation_access import automation_allowed
from app.deps import authenticate_studio_request
from fpl_runtime.claims import HEADER, Actor, issue_context

from .credential_metadata import credential_metadata

router = APIRouter()


@router.get("/_internal/v1/authorize")
async def authorize(request: Request):
    options = request.app.state.identity_options
    supplied = request.headers.get("x-fpl-gateway", "")
    management = bool(options.get("management_gateway_token")) and secrets.compare_digest(
        supplied, options["management_gateway_token"]
    )
    if not management and not secrets.compare_digest(supplied, options["gateway_token"]):
        raise HTTPException(403, "gateway_required")
    service = request.headers.get("x-fpl-target-service", "")
    method = request.headers.get("x-fpl-request-method", "")
    target = urlsplit(request.headers.get("x-fpl-request-uri", ""))
    if target.scheme or target.netloc or target.fragment:
        raise HTTPException(400, "invalid_request_target")
    try:
        path = unquote(target.path, encoding="utf-8", errors="strict")
    except UnicodeDecodeError:
        raise HTTPException(400, "invalid_request_target") from None
    operation = request.app.state.service_catalog.match(method, path)
    if operation is None:
        raise HTTPException(404, "unknown_operation")
    if operation.service != service or service == "identity":
        raise HTTPException(403, "invalid_service_target")
    if not management and (path.startswith("/v1/platform/") or service == "management"):
        raise HTTPException(404, "management_gateway_required")
    origins = options["management_origins"] if management else options["origins"]
    if (
        path.startswith("/v1/platform/local-models/")
        and request.headers.get("x-fpl-ingress") != "local"
    ):
        raise HTTPException(403, "local_management_required")
    origin = origins.get(request.headers.get("x-fpl-ingress"))
    if origin is None or request.headers.get("host") != origin.netloc:
        raise HTTPException(403, "invalid_ingress")
    headers = [
        (name, value)
        for name, value in request.scope["headers"]
        if name.lower() != b"x-fpl-context"
    ]
    scope = {
        **request.scope,
        "path": path,
        "raw_path": path.encode(),
        "method": method,
        "scheme": origin.scheme,
        "query_string": target.query.encode(),
        "headers": headers,
        "state": {"session_policy": MANAGEMENT_SESSION if management else STUDIO_SESSION},
    }
    forwarded = Request(scope)
    permission = route_permission(method, path)
    if permission is None:
        raise HTTPException(403, "unmapped_account_operation")
    authorization = request.headers.get("authorization", "")
    if authorization.lower().startswith("bearer ") and not automation_allowed(method, path):
        raise HTTPException(403, "automation_operation_forbidden")
    required = (
        "studio:private_read"
        if permission in {"content.read", "logs.read", "diagnostics.model", "docs.developer"}
        else "studio:write"
    )
    async with request.app.state.database.sessions() as session:
        principal = await authenticate_studio_request(forwarded, session, required_scope=required)
        if not principal.allows(permission):
            raise HTTPException(403, "insufficient_permission")
        actor = Actor(
            user_id=principal.user_id,
            purpose="management" if management else "studio",
            platform_role=principal.platform_role,
            auth_kind=principal.auth_kind,
            scopes=tuple(sorted(principal.scopes)),
            session_id=principal.session_id,
            api_key_id=principal.api_key_id,
            local=request.headers.get("x-fpl-ingress") == "local"
            and principal.auth_kind == "session",
            reauthenticated_at=(
                principal.reauthenticated_at.isoformat() if principal.reauthenticated_at else None
            ),
            **await credential_metadata(session, principal),
        )
    token = issue_context(
        actor,
        service=service,
        method=method,
        path=path,
        private_key=options["private_key"],
        key_id=options["key_id"],
    )
    return Response(status_code=204, headers={HEADER: token, "Cache-Control": "no-store"})
