"""Extract exact decoded source-frame evidence for a scoped Visual review."""

import asyncio
import json
from pathlib import Path
from tempfile import TemporaryDirectory

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.identity.permissions import effective_permissions
from app.capabilities.media_rendering.video_frames import extract_frame
from app.capabilities.media_rendering.video_sampling import source_frame_time
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.framed_media import content_length, stream_files
from fpl_runtime.visual_samples import (
    FRAMES_HEADER,
    INPUT_HEADER,
    RENDER,
    EvidenceFrame,
    SamplePlan,
    render_target,
)

from .scoped_originals import original_files

router = APIRouter(include_in_schema=False)


async def require_active(request, token):
    active = await request.app.state.identity.status(
        assertion=token, method="POST", path=request.url.path
    )
    if active is not True:
        raise HTTPException(401 if active is False else 503, "visual_sample_authority_ended")


def tokens(request, body, project, run):
    path, state = request.url.path, request.app.state
    if (
        "cookie" in request.headers
        or "origin" in request.headers
        or not render_target("POST", path)
        or body.path(project, run) != path
    ):
        raise HTTPException(403, "visual_sample_plan_changed")
    token = request.headers.get(HEADER, "")
    input_token = request.headers.get(INPUT_HEADER, "")
    try:
        actor = verify_context(
            token,
            service="rendering",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
        owner = verify_context(
            input_token,
            service="assets",
            method="POST",
            path=body.scope.path(project, run),
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_sample_grant_required") from None
    if (
        actor != owner
        or actor.purpose != "studio"
        or "content.write"
        not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "visual_sample_scope_forbidden")
    return actor.user_id, token, input_token


async def extract(source, requested, directory):
    frames, files, seen = [], [], set()
    for position in requested:
        actual = await run_sync(source_frame_time, source, position * 1000)
        milliseconds = int(actual * 1000)
        if milliseconds in seen:
            continue
        seen.add(milliseconds)
        output = directory / f"{milliseconds}.png"
        await extract_frame(source, output, milliseconds, 1024)
        size = output.stat().st_size
        frames.append(
            EvidenceFrame(
                position_ms=milliseconds,
                byte_size=size,
                content_sha256=await run_sync(sha256_file, output),
            )
        )
        files.append((output, size))
    return frames, files


@router.post(RENDER + "/{project_id}/{run_id}/{digest}/{source_digest}")
async def sample_visual_frames(request: Request, project_id: str, run_id: str, body: SamplePlan):
    owner, token, input_token = tokens(request, body, project_id, run_id)
    await require_active(request, token)
    state = request.app.state
    account = state.settings.account_path(owner)
    staging = account / ".tmp" / "visual-samples"
    if staging.is_symlink() or not staging.resolve().is_relative_to(account):
        raise HTTPException(503, "visual_sample_staging_unavailable")
    staging.mkdir(parents=True, exist_ok=True, mode=0o700)
    temp = TemporaryDirectory(dir=staging, prefix="samples-")
    try:
        directory = Path(temp.name)
        if state.visual_sample_slots.locked():
            raise HTTPException(429, "visual_sample_busy")
        async with state.visual_sample_slots:
            scope = body.scope
            originals = await original_files(
                state,
                scope,
                {body.source.id: body.source.byte_size},
                scope.path(project_id, run_id),
                input_token,
                directory,
                operation="visual_sample",
            )
            try:
                frames, files = await extract(
                    originals[body.source.id], body.positions_ms, directory
                )
            except (ValueError, RuntimeError, OSError) as exc:
                raise HTTPException(422, "visual_sample_video_unavailable") from exc
        await require_active(request, token)
        return StreamingResponse(
            stream_files(files),
            media_type="application/octet-stream",
            headers={
                "Content-Length": str(content_length(files)),
                FRAMES_HEADER: json.dumps(
                    [frame.model_dump() for frame in frames], separators=(",", ":")
                ),
                "Cache-Control": "private, no-store",
            },
            background=BackgroundTask(temp.cleanup),
        )
    except BaseException:
        await asyncio.to_thread(temp.cleanup)
        raise
