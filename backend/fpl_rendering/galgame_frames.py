"""Render a frozen Galgame frame with account-scoped original files."""

import shutil
from pathlib import Path
from tempfile import TemporaryDirectory

import httpx
import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.galgame.compiler import compile_galgame_render_plan
from app.capabilities.media_rendering.galgame.lip_sync import prepare_audio_envelopes
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.framed_media import SIZE, FramedInputs
from fpl_runtime.galgame_frames import (
    FRAMES,
    INPUT_HEADER,
    INPUTS,
    MAX_FRAME_REQUEST,
    GalgameFrame,
    frame_target,
)
from fpl_runtime.motion_preview import sha256

router = APIRouter(include_in_schema=False)


async def authorize(request, token):
    active = await request.app.state.identity.status(
        assertion=token, method="POST", path=request.url.path
    )
    if active is not True:
        raise HTTPException(401 if active is False else 503, "galgame_frame_authority_ended")


async def original_files(state, scope, sizes, path, token, directory):
    if not scope.files:
        return {}
    total = sum(SIZE.size + size for size in sizes.values())
    if any(size > state.settings.max_input_bytes for size in sizes.values()):
        raise HTTPException(413, "galgame_frame_original_too_large")
    if total > shutil.disk_usage(directory).free:
        raise HTTPException(507, "galgame_frame_staging_full")
    try:
        async with state.capabilities.client.stream(
            "POST",
            "http://assets:8080" + path,
            content=scope.model_dump_json().encode(),
            headers={HEADER: token, "Accept-Encoding": "identity"},
            timeout=httpx.Timeout(300, connect=5),
        ) as response:
            if response.status_code in {404, 409}:
                raise HTTPException(409, {"code": "source_changed", "message": "渲染原件已变化"})
            if response.status_code in {401, 403}:
                raise HTTPException(response.status_code, "galgame_frame_original_denied")
            response.raise_for_status()
            if (
                response.headers.get("Content-Encoding", "identity") != "identity"
                or response.headers.get("Content-Type") != "application/octet-stream"
                or int(response.headers["Content-Length"]) != total
            ):
                raise ValueError("unexpected Galgame frame originals response")
            framed = FramedInputs(response.aiter_bytes(chunk_size=1024 * 1024))
            originals = {}
            for entry in scope.files:
                size = SIZE.unpack(await framed.read(SIZE.size))[0]
                if size != sizes[entry.id]:
                    raise ValueError("Galgame frame original size changed")
                local = directory / entry.id
                with local.open("xb") as file:
                    await framed.transfer(file, size)
                originals[entry.id] = local
            await framed.require_end(total)
            return originals
    except (CapabilityUnavailable, httpx.HTTPError, KeyError, OSError, ValueError) as exc:
        raise HTTPException(503, "galgame_frame_originals_unavailable") from exc


def prepare_plan(frame, originals, cache):
    fingerprints = {
        item.id: f"{item.id}:{item.revision}:{frame.sizes[item.id]}" for item in frame.scope.files
    }
    envelopes = prepare_audio_envelopes(
        frame.document,
        originals,
        cache_dir=cache,
        asset_fingerprints=fingerprints,
        selected_fragment_ids=set(frame.payload["resolvedFragmentIds"]),
    )
    return compile_galgame_render_plan(
        frame.document,
        frame.payload,
        fragment_durations_ms=frame.fragment_durations_ms,
        total_ms=frame.total_ms,
        asset_paths=originals,
        asset_duration_ms=frame.durations,
        audio_envelopes=envelopes,
    ).plan


def render_png(frame, originals, cache):
    plan = prepare_plan(frame, originals, cache)
    return render_plan_frame(plan, time_us=frame.time_ms * 1000, width=frame.width)


async def frame_body(request, body_digest, scope_digest):
    data = bytearray()
    async for chunk in request.stream():
        if len(data) + len(chunk) > MAX_FRAME_REQUEST:
            raise HTTPException(413, "galgame_frame_body_too_large")
        data.extend(chunk)
    if sha256(data) != body_digest:
        raise HTTPException(403, "galgame_frame_body_digest_changed")
    try:
        frame = GalgameFrame.model_validate_json(bytes(data))
    except ValidationError:
        raise HTTPException(422, "galgame_frame_request_invalid") from None
    if frame.scope.digest != scope_digest:
        raise HTTPException(403, "galgame_frame_scope_digest_changed")
    return frame


@router.post(FRAMES + "/{project_id}/{body_digest}/{scope_digest}")
async def render_galgame_frame(
    request: Request, project_id: str, body_digest: str, scope_digest: str
):
    path = request.url.path
    if "cookie" in request.headers or "origin" in request.headers or not frame_target("POST", path):
        raise HTTPException(403, "private_galgame_frame_required")
    state = request.app.state
    token = request.headers.get(HEADER, "")
    input_token = request.headers.get(INPUT_HEADER, "")
    input_path = f"{INPUTS}/{project_id}/{scope_digest}"
    try:
        actor = verify_context(
            token,
            service="rendering",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
        source_actor = verify_context(
            input_token,
            service="assets",
            method="POST",
            path=input_path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "galgame_frame_grant_required") from None
    if (
        actor != source_actor
        or actor.purpose != "studio"
        or "content.read" not in effective_permissions(actor.platform_role, frozenset(actor.scopes))
    ):
        raise HTTPException(403, "galgame_frame_forbidden")
    frame = await frame_body(request, body_digest, scope_digest)
    await authorize(request, token)
    if state.galgame_frame_slots.locked():
        raise HTTPException(429, "galgame_frame_busy")
    async with state.galgame_frame_slots:
        account = state.settings.account_path(actor.user_id)
        base = account / ".tmp" / "galgame-frames"
        cache = account / "derived" / "galgame-envelopes"
        for path in (base, cache):
            if path.is_symlink() or not path.resolve().is_relative_to(account):
                raise HTTPException(503, "galgame_frame_staging_unavailable")
            path.mkdir(parents=True, exist_ok=True, mode=0o700)
        with TemporaryDirectory(dir=base, prefix="frame-") as folder:
            sources = await original_files(
                state, frame.scope, frame.sizes, input_path, input_token, Path(folder)
            )
            try:
                png = await run_sync(render_png, frame, sources, cache)
            except (KeyError, RuntimeError, TypeError, ValueError) as exc:
                raise HTTPException(
                    422,
                    {
                        "code": "video_export_compilation_failed",
                        "message": f"无法准备确定性口型与动画：{exc}",
                    },
                ) from exc
    await authorize(request, token)
    return Response(png, media_type="image/png", headers={"Cache-Control": "private, no-store"})
