"""Analyze a single signed and fingerprinted Video project audio original."""

from pathlib import Path
from tempfile import TemporaryDirectory

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from studio.apps.media_rendering.local.audio_matching import AudioMatchError, match_audio
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.video_audio import AUDIO_SEAMS, AudioSeamRequest, audio_target
from studio.runtime.files.digests import sha256_file

from .video_frames import active
from .video_originals import download_original

router = APIRouter(include_in_schema=False)


@router.post(AUDIO_SEAMS + "/{project_id}/{asset_id}/{digest}")
async def audio_candidates(request: Request, project_id: str, asset_id: str, digest: str):
    state, path = request.app.state, request.url.path
    if not audio_target("POST", path) or "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_video_audio_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="rendering",
            method="POST",
            path=path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "video_audio_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "video_audio_forbidden")
    jobs = state.video_jobs
    if jobs is None:
        raise HTTPException(503, "video_audio_source_unavailable")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > 4096:
            raise HTTPException(413, "video_audio_request_too_large")
        raw.extend(chunk)
    if sha256(raw) != digest:
        raise HTTPException(403, "video_audio_scope_changed")
    try:
        plan = AudioSeamRequest.model_validate_json(bytes(raw))
        if plan.reference_end_us > plan.duration_us:
            raise ValueError("invalid audio span")
    except (ValidationError, ValueError):
        raise HTTPException(422, "video_audio_request_invalid") from None
    await active(state, token, path)
    if state.video_audio_slots.locked():
        raise HTTPException(429, "video_audio_busy")
    async with state.video_audio_slots:
        account = state.settings.account_path(actor.user_id)
        staging = account / ".tmp" / "video-audio"
        staging.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not staging.resolve().is_relative_to(account):
            raise HTTPException(503, "video_audio_storage_unavailable")
        with TemporaryDirectory(dir=staging, prefix="analysis-") as temporary:
            source = Path(temporary) / "original"
            try:
                original = await download_original(
                    jobs.client,
                    jobs.originals,
                    owner=actor.user_id,
                    project=project_id,
                    asset=asset_id,
                    target=source,
                    max_bytes=state.settings.max_input_bytes,
                )
            except ValueError:
                raise HTTPException(
                    422, {"code": "audio_source_missing", "message": "源音频文件不存在"}
                ) from None
            if original.kind != "audio" or await run_sync(sha256_file, source) != plan.fingerprint:
                raise HTTPException(409, "video_audio_source_changed")
            from functools import partial

            try:
                result = await run_sync(
                    partial(
                        match_audio,
                        source,
                        asset_id=asset_id,
                        duration_us=plan.duration_us,
                        reference_end_us=plan.reference_end_us,
                        search_end_us=plan.search_end_us,
                        rate=plan.rate,
                    )
                )
            except AudioMatchError as exc:
                raise HTTPException(422, {"code": exc.code, "message": str(exc)}) from None
        await active(state, token, path)
    return result
