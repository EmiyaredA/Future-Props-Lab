"""Render one frozen Video frame or isolated text layer from scoped originals."""

from collections import OrderedDict
from functools import partial
from pathlib import Path
from tempfile import TemporaryDirectory

import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError

from app.capabilities.media_rendering.contracts import RenderCaptureFrame, RenderPlan
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.text_layer import text_layer_png
from app.capabilities.media_rendering.timeline_ranges import frame_asset_ids, timeline_duration_us
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.motion_compositor.motion_preview import sha256
from studio.contracts.video_editor.timeline_document import VideoEditorClip, parse_timeline_document
from studio.contracts.video_editor.video_frames import (
    INPUTS,
    MAX_FRAME_BYTES,
    PREFIX,
    TextLayerRequest,
    VideoFrameRequest,
    clip_digest,
    target,
)

from .motion_preview import fetch_sources

router = APIRouter(include_in_schema=False)


class VideoFrameCache:
    def __init__(self):
        self.items = OrderedDict()

    def get(self, key):
        payload = self.items.get(key)
        if payload is not None:
            self.items.move_to_end(key)
        return payload

    def save(self, key, payload):
        if len(payload) <= 1024 * 1024:
            self.items[key] = payload
            self.items.move_to_end(key)
            if len(self.items) > 32:
                self.items.popitem(last=False)


def frame_input(raw, clip_id):
    if clip_id:
        request = TextLayerRequest.model_validate_json(raw)
        clip = VideoEditorClip.model_validate(request.clip)
        if clip_digest(clip.id) != clip_id or clip.kind != "text":
            raise ValueError("剪辑文字图层无效")
        ids = {clip.font_asset_id} if clip.font_asset_id else set()

        def render(sources):
            return text_layer_png(clip, sources.get(clip.font_asset_id))

    else:
        request = VideoFrameRequest.model_validate_json(raw)
        document = parse_timeline_document(request.document)
        if request.time_us > timeline_duration_us(document):
            raise ValueError("剪辑预览时间无效")
        if request.without_chroma_clip_id and not any(
            clip.id == request.without_chroma_clip_id
            and clip.chroma_key
            and clip.chroma_key.enabled
            for track in document.tracks
            for clip in track.clips
        ):
            raise ValueError("剪辑预览对比片段无效")
        ids = frame_asset_ids(document, request.time_us)

        def render(sources):
            return render_plan_frame(
                RenderPlan(
                    document=document,
                    asset_paths=sources,
                    capture_frame=RenderCaptureFrame(
                        width=document.settings.width, height=document.settings.height
                    ),
                ),
                time_us=request.time_us,
                width=request.width,
                without_chroma_clip_id=request.without_chroma_clip_id,
            )

    if ids != {entry.id for entry in request.scope.files}:
        raise ValueError("剪辑预览的文件范围与文稿不符")
    return request.scope, render


async def active(state, token, path):
    authorized = await state.identity.status(assertion=token, method="POST", path=path)
    if authorized is None:
        raise HTTPException(503, "identity_unavailable")
    if not authorized:
        raise HTTPException(401, "video_frame_revoked")


@router.post(PREFIX + "/{project_id}/{view:path}")
async def frame(request: Request, project_id: str, view: str):
    path = f"{PREFIX}/{project_id}/{view}"
    scope = target("POST", path)
    if not scope or "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "private_video_frame_required")
    clip_id, digest, scope_digest = scope[3], scope[4], scope[5]
    state = request.app.state
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
        raise HTTPException(401, "video_frame_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "video_frame_forbidden")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_FRAME_BYTES:
            raise HTTPException(413, "video_frame_request_too_large")
        raw.extend(chunk)
    if sha256(raw) != digest:
        raise HTTPException(403, "video_frame_document_changed")
    try:
        files, render = frame_input(bytes(raw), clip_id)
        if files.digest != scope_digest:
            raise ValueError("剪辑预览文件范围摘要不符")
    except (ValidationError, ValueError):
        raise HTTPException(422, "video_frame_request_invalid") from None
    await active(state, token, path)
    cache = state.video_frame_cache
    key = (actor.user_id, path)
    cached = cache.get(key)
    if cached is not None:
        return Response(cached, media_type="image/png", headers={"Cache-Control": "no-store"})
    if state.video_frame_slots.locked():
        raise HTTPException(429, "video_frame_busy")
    async with state.video_frame_slots:
        account = state.settings.account_path(actor.user_id)
        base = account / ".tmp" / "video-frames"
        base.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not base.resolve().is_relative_to(account):
            raise HTTPException(503, "video_frame_storage_unavailable")
        with TemporaryDirectory(dir=base, prefix="frame-") as staging:
            media = await fetch_sources(
                state,
                path,
                project_id,
                files,
                token,
                Path(staging),
                input_prefix=INPUTS,
            )
            try:
                payload = await run_sync(partial(render, media))
            except (ValueError, OSError):
                raise HTTPException(
                    422, "invalid_text_layer" if clip_id else "video_frame_invalid"
                ) from None
        await active(state, token, path)
    cache.save(key, payload)
    return Response(payload, media_type="image/png", headers={"Cache-Control": "no-store"})
