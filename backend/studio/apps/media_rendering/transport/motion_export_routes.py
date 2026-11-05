"""Private, digest-bound staging and recovery of Rendering's Motion jobs."""

import re
from pathlib import Path
from shutil import rmtree
from tempfile import TemporaryDirectory
from typing import Literal

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import ValidationError

from studio.apps.media_rendering.local.motion_outputs import OUTPUT_NAMES
from studio.apps.media_rendering.motion_preview import fetch_sources
from studio.apps.media_rendering.storage.file_paths import sync_directory, sync_files
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.document import MotionComposition
from studio.contracts.motion_compositor.motion_exports import (
    PREFIX,
    RenderRequest,
    export_media,
    render_target,
)
from studio.contracts.motion_compositor.motion_preview import MAX_SCENE_BYTES, sha256

router = APIRouter(include_in_schema=False)


def render_actor(request):
    if (
        "origin" in request.headers
        or "cookie" in request.headers
        or not render_target("POST", request.url.path)
    ):
        raise HTTPException(403, "private_motion_export_required")
    assertion = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            assertion,
            service="rendering",
            method="POST",
            path=request.url.path,
            public_key=request.app.state.identity_public_key,
            allow_expired=True,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_export_authorization_required") from None
    if actor.purpose != "studio" or "content.write" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_export_forbidden")
    return actor, assertion


async def read_payload(request, body_digest, scope_digest):
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_SCENE_BYTES:
            raise HTTPException(413, "motion_scene_too_large")
        raw.extend(chunk)
    if sha256(raw) != body_digest:
        raise HTTPException(403, "motion_scene_digest_changed")
    try:
        payload = RenderRequest.model_validate_json(bytes(raw))
        document = MotionComposition.model_validate(payload.document)
    except ValidationError:
        raise HTTPException(422, "motion_scene_invalid") from None
    if (
        payload.scope.digest != scope_digest
        or payload.window.end > document.settings.duration_frames
        or {item.id for item in payload.scope.files}
        != export_media(document, payload.window.start, payload.window.end)
    ):
        raise HTTPException(422, "motion_export_scope_invalid")
    return payload


async def require_active(state, assertion, path):
    active = await state.identity.status(assertion=assertion, method="POST", path=path)
    if active is None:
        raise HTTPException(503, "identity_unavailable")
    if not active:
        raise HTTPException(401, "motion_export_revoked")


@router.post(PREFIX + "/{project_id}/{task_id}/{body_digest}/{scope_digest}")
async def delivery(
    request: Request,
    project_id: str,
    task_id: str,
    body_digest: str,
    scope_digest: str,
):
    actor, assertion = render_actor(request)
    state = request.app.state
    if state.motion_export_peer is None:
        raise HTTPException(503, "motion_export_peer_unavailable")
    jobs = state.motion_jobs
    owner, path = actor.user_id, request.url.path
    async with job_lock(state, task_id):
        job = await jobs.load(owner, task_id)
        if job is not None:
            if job.request_path != path:
                raise HTTPException(409, "motion_export_request_changed")
            return jobs.receipt(job)
        payload = await read_payload(request, body_digest, scope_digest)
        await require_active(state, assertion, path)
        folder = jobs.folder(owner, task_id)
        folder.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        with TemporaryDirectory(dir=folder.parent, prefix=".intake-") as temporary:
            staged = Path(temporary) / "sealed"
            inputs = staged / "inputs"
            inputs.mkdir(parents=True, mode=0o700)
            await fetch_sources(
                state, path, project_id, payload.scope, assertion, inputs, exporting=True
            )
            await run_sync(sync_files, inputs)
            await run_sync(sync_directory, staged)
            await require_active(state, assertion, path)
            # An orphaned directory here belongs to a submission interrupted before commit.
            if folder.exists():
                await run_sync(lambda: rmtree(folder))
            staged.rename(folder)
            for directory in (
                folder.parent,
                folder.parent.parent,
                state.settings.runtime_path / "accounts",
            ):
                await run_sync(sync_directory, directory)
            return await jobs.enqueue(
                owner=owner,
                project=project_id,
                task_id=task_id,
                path=path,
                assertion=assertion,
                payload=payload,
            )


def job_lock(state, task_id):
    return state.motion_submission_locks[int(task_id[:2], 16) % len(state.motion_submission_locks)]


def control_owner(request, task_id):
    peer = request.app.state.motion_export_peer
    if (
        peer is None
        or "origin" in request.headers
        or "cookie" in request.headers
        or not re.fullmatch(r"[a-f0-9]{32}", task_id)
    ):
        raise HTTPException(403, "private_motion_export_required")
    try:
        return peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_motion_export_required") from None


@router.post(PREFIX + "/{task_id}/control/{action}")
async def control(request: Request, task_id: str, action: Literal["status", "cancel", "purge"]):
    owner = control_owner(request, task_id)
    state = request.app.state
    jobs = state.motion_jobs
    async with job_lock(state, task_id):
        job = await jobs.load(owner, task_id)
        if job is None:
            raise HTTPException(404, "motion_export_missing")
        if action == "cancel":
            await jobs.cancel(owner, task_id)
        elif action == "purge":
            if job.status in {"queued", "running"}:
                await jobs.cancel(owner, task_id)
                raise HTTPException(409, "motion_export_pending_cancellation")
            folder = jobs.folder(owner, task_id)
            await run_sync(lambda: rmtree(folder, ignore_errors=True))
            if folder.exists():
                raise HTTPException(503, "motion_export_cleanup_unavailable")
            await jobs.set_state(
                job, status="cancelled", payload={}, assertion="", outputs={}, progress=0
            )
        return jobs.receipt(await jobs.load(owner, task_id))


@router.get(PREFIX + "/{task_id}/download/{format_name}")
async def download(request: Request, task_id: str, format_name: str):
    owner = control_owner(request, task_id)
    jobs = request.app.state.motion_jobs
    job = await jobs.load(owner, task_id)
    filename = OUTPUT_NAMES.get(format_name)
    if (
        job is None
        or job.status != "completed"
        or not filename
        or job.outputs.get(format_name) != filename
    ):
        raise HTTPException(404, "motion_export_file_missing")
    folder = jobs.folder(owner, task_id)
    path = folder / "outputs" / filename
    if not path.resolve().is_relative_to(folder) or path.is_symlink() or not path.is_file():
        raise HTTPException(404, "motion_export_file_missing")
    return FileResponse(path, filename=filename, headers={"Cache-Control": "no-store"})
