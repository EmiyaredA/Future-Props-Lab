"""Private, digest-bound archive staging and authenticated source settlement."""

import re

import jwt
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError
from starlette.responses import JSONResponse

from studio.apps.asset_library.transport.service.library_outputs import OutputStream
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveOutcome


def archive_context(request, auth_field, archive_factory):
    if request.headers.get("origin") or request.headers.get("cookie"):
        raise HTTPException(403, "private_archive_request_required")
    if request.headers.get("content-encoding", "identity").strip().lower() != "identity":
        raise HTTPException(422, "archive_encoding_forbidden")
    state = request.app.state
    auth = getattr(state, auth_field, None)
    if auth is None:
        raise HTTPException(503, "archive_authorization_unavailable")
    nonce = request.headers.get("x-fpl-archive-nonce", "")
    if not re.fullmatch(r"[a-f0-9]{32}", nonce):
        raise HTTPException(422, "invalid_archive_nonce")
    return auth, nonce, archive_factory(state.database, state.settings)


def actor_for(request, archive_target):
    if not archive_target(request.method, request.url.path):
        raise HTTPException(404, "archive_target_not_found")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="assets",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "archive_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "archive_forbidden")
    return actor


async def require_active(request):
    state = await request.app.state.identity.status(
        assertion=request.headers.get(HEADER, ""), method=request.method, path=request.url.path
    )
    if state is None:
        raise HTTPException(503, "archive_authorization_unavailable")
    if not state:
        raise HTTPException(401, "archive_authorization_revoked")


async def bounded_body(request, limit):
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > limit:
            raise HTTPException(413, "archive_request_too_large")
        content.extend(chunk)
    return bytes(content)


def receipt(request, auth, nonce, owner, result):
    response = JSONResponse(result)
    response.headers["X-Fpl-Archive-Receipt"] = auth.sign(
        "receipt", path=request.url.path, owner=owner, nonce=nonce, body=response.body
    )
    return response


def archive_router(
    *,
    prefix,
    archive_target,
    auth_field,
    archive_factory,
    descriptor_type,
    manifest_type,
    max_manifest_bytes,
    max_file_bytes=None,
):
    router = APIRouter(include_in_schema=False)

    @router.post(prefix + "/{batch_id}/{source_sha256}/files/{ordinal}/{fingerprint}")
    async def stage(
        request: Request, batch_id: str, source_sha256: str, ordinal: int, fingerprint: str
    ):
        auth, nonce, archives = archive_context(request, auth_field, archive_factory)
        actor = actor_for(request, archive_target)
        try:
            key = ArchiveBatchKey(batch_id=batch_id, source_sha256=source_sha256)
            description = descriptor_type.from_header(
                request.headers.get("x-fpl-upload-descriptor", "")
            )
            length = int(request.headers.get("content-length", "-1"))
        except (ValueError, TypeError):
            raise HTTPException(422, "invalid_archive_file") from None
        if length != description.byte_size or description.fingerprint != fingerprint:
            raise HTTPException(422, "archive_file_descriptor_mismatch")
        limit = archives.file_limit() or request.app.state.settings.fpl_visual_asset_max_bytes
        if max_file_bytes is not None:
            limit = min(limit, max_file_bytes)
        if length > limit:
            raise HTTPException(413, "archive_file_too_large")

        async def active():
            await require_active(request)

        result = await archives.stage_file(
            owner=actor.user_id,
            key=key,
            ordinal=ordinal,
            description=description,
            incoming=OutputStream(request, description),
            require_active=active,
        )
        return receipt(request, auth, nonce, actor.user_id, result)

    @router.post(prefix + "/{batch_id}/{source_sha256}/seal/{fingerprint}")
    async def seal(request: Request, batch_id: str, source_sha256: str, fingerprint: str):
        auth, nonce, archives = archive_context(request, auth_field, archive_factory)
        actor = actor_for(request, archive_target)
        data = await bounded_body(request, max_manifest_bytes)
        try:
            key = ArchiveBatchKey(batch_id=batch_id, source_sha256=source_sha256)
            manifest = manifest_type.model_validate_json(data)
        except ValidationError:
            raise HTTPException(422, "invalid_archive_manifest") from None
        if manifest.fingerprint != fingerprint:
            raise HTTPException(422, "archive_manifest_mismatch")
        await require_active(request)
        state = await archives.seal(owner=actor.user_id, key=key, manifest=manifest)
        return receipt(request, auth, nonce, actor.user_id, {"state": state})

    @router.post(prefix + "/settle")
    async def settle(request: Request):
        auth, nonce, archives = archive_context(request, auth_field, archive_factory)
        data = await bounded_body(request, 2048)
        try:
            outcome = ArchiveOutcome.model_validate_json(data)
            auth.verify(
                request.headers.get("x-fpl-archive-decision", ""),
                "decision",
                path=request.url.path,
                owner=outcome.owner,
                nonce=nonce,
                body=data,
            )
        except ValueError:
            raise HTTPException(401, "archive_decision_required") from None
        state = await archives.settle(
            owner=outcome.owner,
            key=outcome,
            commit=outcome.decision == "commit",
            manifest_sha256=outcome.manifest_sha256,
        )
        return receipt(request, auth, nonce, outcome.owner, {"state": state})

    return router
