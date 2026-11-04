"""Authenticate and stream an exact Galgame voice file to the Models attempt owner."""

import hashlib
from tempfile import TemporaryFile

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.identity.permissions import effective_permissions
from app.llm.provider_transports import provider_options
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.galgame_asr_execution import (
    DESCRIPTION_HEADER,
    EXECUTION,
    MAX_BYTES,
    AsrInput,
    AsrOutcome,
    execution_target,
)
from fpl_runtime.project_errors import ProjectResourceError

router = APIRouter(include_in_schema=False)


async def require_active(request):
    active = await request.app.state.identity.status(
        assertion=request.headers.get(HEADER, ""), method=request.method, path=request.url.path
    )
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_asr_authority_ended")


async def owned_attempt(request):
    if (
        "cookie" in request.headers
        or "origin" in request.headers
        or not execution_target(request.method, request.url.path)
    ):
        raise HTTPException(403, "galgame_asr_execution_grant_required")
    try:
        actor = verify_context(
            request.headers.get(HEADER, ""),
            service="models",
            method=request.method,
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, TypeError, ValueError):
        raise HTTPException(401, "galgame_asr_execution_grant_required") from None
    if actor.purpose != "studio" or "models.use" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_asr_execution_forbidden")
    await require_active(request)
    return actor


async def receive_audio(request, body, audio):
    digest, received = hashlib.sha256(), 0
    async for chunk in request.stream():
        received += len(chunk)
        if received > body.byte_size:
            raise HTTPException(422, "galgame_asr_input_length_changed")
        digest.update(chunk)
        await run_sync(audio.write, chunk)
    if received != body.byte_size or digest.hexdigest() != body.content_sha256:
        raise HTTPException(422, "galgame_asr_input_digest_changed")
    await run_sync(audio.seek, 0)


@router.get(EXECUTION + "/{project_id}/{task_id}/{fingerprint}", response_model=AsrOutcome)
async def read_galgame_attempt(request: Request, task_id: str, fingerprint: str):
    actor = await owned_attempt(request)
    try:
        result = await request.app.state.galgame_transcription.read(
            actor.user_id, task_id, fingerprint
        )
    except ProjectResourceError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    if result is None:
        raise HTTPException(404, "galgame_asr_attempt_not_found")
    return result


@router.post(EXECUTION + "/{project_id}/{task_id}/{fingerprint}", response_model=AsrOutcome)
async def execute_galgame_attempt(request: Request, task_id: str, fingerprint: str):
    actor = await owned_attempt(request)
    try:
        body = AsrInput.from_header(request.headers.get(DESCRIPTION_HEADER, ""))
        size = int(request.headers.get("Content-Length", "0"))
    except ValueError:
        raise HTTPException(422, "galgame_asr_input_metadata_invalid") from None
    if body.path != request.url.path or body.task_id != task_id:
        raise HTTPException(403, "galgame_asr_input_scope_changed")
    if size > MAX_BYTES:
        raise HTTPException(413, "galgame_asr_input_too_large")
    if (
        size != body.byte_size
        or request.headers.get("Content-Encoding", "identity") != "identity"
        or request.headers.get("Content-Type") != "application/octet-stream"
    ):
        raise HTTPException(422, "galgame_asr_input_metadata_changed")
    service = request.app.state.galgame_transcription
    try:
        if previous := await service.read(actor.user_id, task_id, fingerprint):
            return previous
        with TemporaryFile(dir=request.app.state.galgame_asr_staging) as audio:
            await receive_audio(request, body, audio)
            await require_active(request)
            return await service.execute(
                actor, body, fingerprint, audio, lambda url: provider_options(request, url)
            )
    except ProjectResourceError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
