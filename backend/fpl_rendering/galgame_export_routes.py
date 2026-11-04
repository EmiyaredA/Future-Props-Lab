"""Submit, observe and download one strictly scoped Galgame render job."""

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.galgame_exports import (
    INPUTS,
    JOBS,
    ExportReceipt,
    GalgameExport,
    job_target,
    submit_target,
)
from fpl_runtime.galgame_frames import INPUT_HEADER, MAX_FRAME_REQUEST
from fpl_runtime.motion_preview import sha256

from .galgame_export_jobs import receipt

router = APIRouter(include_in_schema=False)


async def authorize(request, scope, *, inputs=None):
    if not scope or "cookie" in request.headers or "origin" in request.headers:
        raise HTTPException(403, "private_galgame_render_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="rendering",
            method=request.method,
            path=request.url.path,
            public_key=state.identity_public_key,
        )
        if inputs is not None:
            input_actor = verify_context(
                request.headers.get(INPUT_HEADER, ""),
                service="assets",
                method="POST",
                path=inputs,
                public_key=state.identity_public_key,
            )
            if actor != input_actor:
                raise HTTPException(403, "galgame_render_actor_changed")
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_render_grant_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "galgame_render_forbidden")
    active = await state.identity.status(
        assertion=token, method=request.method, path=request.url.path
    )
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_render_authority_ended")
    return actor, token


async def read_body(request, fingerprint, scope_digest):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_FRAME_REQUEST:
            raise HTTPException(413, "galgame_render_body_too_large")
        data.extend(chunk)
    if sha256(data) != fingerprint:
        raise HTTPException(403, "galgame_render_body_changed")
    try:
        body = GalgameExport.model_validate_json(bytes(data))
    except ValidationError:
        raise HTTPException(422, "galgame_render_body_invalid") from None
    if body.scope.digest != scope_digest:
        raise HTTPException(403, "galgame_render_scope_changed")
    return body


@router.post(
    JOBS + "/{project_id}/{job_id}/{fingerprint}/submit/{scope_digest}",
    response_model=ExportReceipt,
)
async def submit_export(
    request: Request, project_id: str, job_id: str, fingerprint: str, scope_digest: str
):
    path = request.url.path
    actor, token = await authorize(
        request,
        submit_target("POST", path),
        inputs=f"{INPUTS}/{project_id}/{job_id}/{scope_digest}",
    )
    body = await read_body(request, fingerprint, scope_digest)
    return await request.app.state.galgame_exports.enqueue(
        actor.user_id,
        project_id,
        job_id,
        fingerprint,
        path,
        token,
        request.headers[INPUT_HEADER],
        body,
    )


@router.get(JOBS + "/{project_id}/{job_id}/{fingerprint}", response_model=ExportReceipt)
async def export_status(request: Request, project_id: str, job_id: str, fingerprint: str):
    actor, _ = await authorize(request, job_target("GET", request.url.path))
    job = await request.app.state.galgame_exports.get(
        actor.user_id, project_id, job_id, fingerprint
    )
    return receipt(job)


@router.post(JOBS + "/{project_id}/{job_id}/{fingerprint}/cancel", response_model=ExportReceipt)
async def cancel_export(request: Request, project_id: str, job_id: str, fingerprint: str):
    actor, _ = await authorize(request, job_target("POST", request.url.path))
    return await request.app.state.galgame_exports.cancel(
        actor.user_id, project_id, job_id, fingerprint
    )


@router.get(JOBS + "/{project_id}/{job_id}/{fingerprint}/download")
async def download_export(request: Request, project_id: str, job_id: str, fingerprint: str):
    actor, _ = await authorize(request, job_target("GET", request.url.path))
    exports = request.app.state.galgame_exports
    job = await exports.get(actor.user_id, project_id, job_id, fingerprint)
    if job.released or job.status != "completed" or not job.media:
        raise HTTPException(404, "galgame_render_output_unavailable")
    path = exports.folder(actor.user_id, job_id) / "sealed" / "output.mp4"
    if path.is_symlink() or not path.is_file() or path.stat().st_size != job.media["byte_size"]:
        raise HTTPException(503, "galgame_render_output_missing")
    return FileResponse(path, media_type="video/mp4", headers={"Cache-Control": "no-store"})


@router.post(JOBS + "/{project_id}/{job_id}/{fingerprint}/release")
async def release_export(request: Request, project_id: str, job_id: str, fingerprint: str):
    actor, _ = await authorize(request, job_target("POST", request.url.path))
    return await request.app.state.galgame_exports.release(
        actor.user_id, project_id, job_id, fingerprint
    )
