"""A fixed, fail-closed bridge for attesting one original Creative import body.

This ASGI app must only be served on a container-private Unix socket. It is not
mounted on the public Gateway application and does not authorize installation.
"""

import base64
import hashlib
import secrets

import httpx
import jwt
from fastapi import FastAPI, HTTPException, Request
from starlette.responses import Response

from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.creative_source_evidence import (
    MAX_BODY,
    SOURCE_PATH,
    source_fields,
    verify_source_evidence,
)

BRIDGE_PATH = "/_bridge/creative/source-import"
EVIDENCE_PATH = "/_internal/v1/authorization/creative-source-evidence"


def create_creative_bridge(*, public_key, gateway_credential, ingress_secret, transport=None):
    if (
        not isinstance(gateway_credential, str)
        or not isinstance(ingress_secret, str)
        or not gateway_credential.isascii()
        or not ingress_secret.isascii()
        or len(gateway_credential) < 32
        or len(ingress_secret) < 32
        or secrets.compare_digest(gateway_credential, ingress_secret)
    ):
        raise ValueError("Creative bridge requires distinct strong gateway and ingress credentials")
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.post(BRIDGE_PATH, include_in_schema=False)
    async def import_source(request: Request):
        supplied = request.headers.get("x-fpl-bridge-ingress", "")
        if not supplied.isascii() or not secrets.compare_digest(supplied, ingress_secret):
            raise HTTPException(403, "creative_bridge_ingress_required")
        if (
            request.url.query
            or request.headers.get("content-encoding", "identity").lower() != "identity"
        ):
            raise HTTPException(400, "creative_bridge_request_invalid")
        if (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            != "application/json"
        ):
            raise HTTPException(415, "creative_bridge_json_required")
        assertion = request.headers.get(HEADER, "")
        try:
            actor = verify_context(
                assertion,
                service="creative",
                method="POST",
                path=SOURCE_PATH,
                public_key=public_key,
            )
            claims = jwt.decode(
                assertion,
                public_key,
                algorithms=["EdDSA"],
                issuer="fpl-identity",
                audience="creative",
                options={"require": ["jti", "exp"]},
            )
        except (jwt.InvalidTokenError, ValueError, TypeError):
            raise HTTPException(401, "creative_bridge_assertion_invalid") from None
        body = bytearray()
        async for chunk in request.stream():
            body.extend(chunk)
            if len(body) > MAX_BODY:
                raise HTTPException(413, "creative_bridge_request_too_large")
        raw = bytes(body)
        try:
            kind, source_id = source_fields(raw)
        except (ValueError, TypeError, UnicodeError):
            raise HTTPException(422, "creative_bridge_request_invalid") from None
        # Separate clients per request and upstream prevent an upstream Set-Cookie
        # from being replayed to any later account, even under concurrency.
        try:
            async with httpx.AsyncClient(
                transport=transport, trust_env=False, follow_redirects=False, timeout=10
            ) as identity:
                response = await identity.post(
                    "http://identity:8080" + EVIDENCE_PATH,
                    headers={"Authorization": "Bearer " + gateway_credential},
                    json={
                        "assertion": assertion,
                        "body_base64": base64.b64encode(raw).decode("ascii"),
                    },
                )
                if response.status_code in {401, 403}:
                    raise HTTPException(
                        response.status_code, "creative_bridge_authorization_denied"
                    )
                response.raise_for_status()
                evidence = response.json()["evidence"]
                verify_source_evidence(
                    evidence,
                    public_key=public_key,
                    owner_user_id=actor.user_id,
                    request_id=claims["jti"],
                    body_sha256=hashlib.sha256(raw).hexdigest(),
                    kind=kind,
                    source_id=source_id,
                )
        except HTTPException:
            raise
        except (httpx.HTTPError, ValueError, KeyError, TypeError, jwt.InvalidTokenError):
            raise HTTPException(503, "creative_bridge_authorization_unavailable") from None
        headers = {
            HEADER: assertion,
            "X-Fpl-Creative-Source-Evidence": evidence,
            "Content-Type": "application/json",
        }
        for name in ("x-application-id", "x-application-build"):
            value = request.headers.get(name)
            if value:
                headers[name] = value
        try:
            async with httpx.AsyncClient(
                transport=transport, trust_env=False, follow_redirects=False, timeout=10
            ) as creative:
                async with creative.stream(
                    "POST", "http://creative:8080" + SOURCE_PATH, headers=headers, content=raw
                ) as result:
                    content = bytearray()
                    async for chunk in result.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 2 * 1024 * 1024:
                            raise HTTPException(503, {"code": "creative_import_outcome_unknown"})
                    status = result.status_code
                    media_type = result.headers.get("content-type", "application/json")
        except httpx.HTTPError:
            # Once forwarded, a lost reply cannot establish that creation failed.
            raise HTTPException(503, {"code": "creative_import_outcome_unknown"}) from None
        return Response(
            content=bytes(content),
            status_code=status,
            headers={"Cache-Control": "no-store"},
            media_type=media_type,
        )

    return app


def private_socket(directory):
    """Bind an owner-only UDS; never remove an existing path or follow a link."""
    import os
    import socket
    import stat
    from pathlib import Path

    directory = Path(directory)
    if directory.is_symlink():
        raise ValueError("Creative bridge socket directory cannot be a symlink")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.stat()
    if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
        raise ValueError("Creative bridge socket directory must be private to the current user")
    path = directory / "creative.sock"
    if path.exists() or path.is_symlink():
        raise ValueError("Creative bridge socket path is already in use")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(str(path))
        os.chmod(path, 0o600)
        listener.listen(128)
        return listener, path
    except BaseException:
        listener.close()
        raise


def private_text(path):
    """Read an owner-only credential through a non-following file descriptor."""
    import os
    import stat
    from pathlib import Path

    path = Path(path)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise ValueError("Creative bridge credential cannot be a symlink or unreadable") from exc
    try:
        info = os.fstat(descriptor)
        if (
            not stat.S_ISREG(info.st_mode)
            or info.st_uid != os.getuid()
            or stat.S_IMODE(info.st_mode) & 0o077
            or info.st_size > 4096
        ):
            raise ValueError("Creative bridge credential must be an owner-only file")
        with os.fdopen(descriptor, "r", encoding="utf-8", closefd=False) as stream:
            value = stream.read(4097)
        if len(value.encode("utf-8")) > 4096:
            raise ValueError("Creative bridge credential is too large")
        return value.strip()
    finally:
        os.close(descriptor)
