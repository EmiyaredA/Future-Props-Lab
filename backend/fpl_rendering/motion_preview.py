"""Render an exact Motion frame without reading the workshop database or file volumes."""

import io
import tempfile
from pathlib import Path

import httpx
import jwt
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from pydantic import ValidationError

from app.capabilities.identity.permissions import effective_permissions
from app.capabilities.media_rendering.motion_document import MotionComposition
from app.capabilities.media_rendering.motion_frames import MotionFrameRenderer
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.claims import HEADER, verify_context
from fpl_runtime.motion_preview import (
    INPUTS,
    MAX_SCENE_BYTES,
    PREFIX,
    SIZE,
    FrameRequest,
    active_media,
    preview_target,
    sha256,
)

router = APIRouter(include_in_schema=False)


class FramedInputs:
    def __init__(self, response):
        self.chunks = response.aiter_bytes(chunk_size=1024 * 1024).__aiter__()
        self.buffer = bytearray()
        self.received = 0

    async def read(self, size):
        while len(self.buffer) < size:
            chunk = await anext(self.chunks, b"")
            if not chunk:
                raise CapabilityUnavailable("渲染原件传输未完成")
            self.buffer.extend(chunk)
        data = bytes(self.buffer[:size])
        del self.buffer[:size]
        self.received += size
        return data

    async def unpack(self, root, scope, maximum):
        paths = {}
        for source in scope.files:
            size = SIZE.unpack(await self.read(SIZE.size))[0]
            if not 0 < size <= maximum:
                raise HTTPException(413, {"code": "file_too_large", "message": "渲染原件超限"})
            path = root / source.id
            with path.open("xb") as file:
                remaining = size
                while remaining:
                    chunk = await self.read(min(remaining, 1024 * 1024))
                    await run_sync(file.write, chunk)
                    remaining -= len(chunk)
            paths[source.id] = path
        if self.buffer or await anext(self.chunks, b""):
            raise CapabilityUnavailable("渲染原件传输包含额外数据")
        return paths


async def authorized(request, assertion):
    active = await request.app.state.identity.status(
        assertion=assertion, method="POST", path=request.url.path
    )
    if active is None:
        raise HTTPException(503, "identity_unavailable")
    if not active:
        raise HTTPException(401, "motion_preview_revoked")


def png(document, media, frame):
    with MotionFrameRenderer(document, media).render(frame) as image:
        buffer = io.BytesIO()
        image.save(buffer, format="PNG")
        return buffer.getvalue()


async def fetch_sources(request, project_id, scope, assertion, root):
    if not scope.files:
        return {}
    state = request.app.state
    try:
        async with state.capabilities.client.stream(
            "POST",
            f"http://assets:8080{INPUTS}/{project_id}/{scope.digest}",
            content=scope.model_dump_json().encode(),
            headers={
                HEADER: assertion,
                "X-Fpl-Render-Target": request.url.path,
                "Accept-Encoding": "identity",
            },
            timeout=httpx.Timeout(120, connect=5),
        ) as response:
            if response.status_code == 409:
                raise HTTPException(409, {"code": "source_changed", "message": "渲染原件已变化"})
            response.raise_for_status()
            if (
                response.headers.get("Content-Encoding", "identity") != "identity"
                or response.headers.get("Content-Type") != "application/octet-stream"
            ):
                raise ValueError("invalid frame source response")
            total = int(response.headers["Content-Length"])
            framed = FramedInputs(response)
            result = await framed.unpack(root, scope, state.settings.max_input_bytes)
            if total != framed.received:
                raise ValueError("invalid frame source length")
            return result
    except (httpx.HTTPError, ValueError, OSError, KeyError) as exc:
        raise CapabilityUnavailable("渲染原件暂不可用") from exc


@router.post(PREFIX + "/{project_id}/{body_digest}/{scope_digest}")
async def render(request: Request, project_id: str, body_digest: str, scope_digest: str):
    if (
        "origin" in request.headers
        or "cookie" in request.headers
        or not preview_target("POST", request.url.path)
    ):
        raise HTTPException(403, "private_motion_preview_required")
    assertion = request.headers.get(HEADER, "")
    state = request.app.state
    try:
        actor = verify_context(
            assertion,
            service="rendering",
            method="POST",
            path=request.url.path,
            public_key=state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "motion_preview_authorization_required") from None
    if actor.purpose != "studio" or "content.read" not in effective_permissions(
        actor.platform_role, frozenset(actor.scopes)
    ):
        raise HTTPException(403, "motion_preview_forbidden")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_SCENE_BYTES:
            raise HTTPException(413, "motion_scene_too_large")
        raw.extend(chunk)
    if sha256(raw) != body_digest:
        raise HTTPException(403, "motion_scene_digest_changed")
    try:
        frame = FrameRequest.model_validate_json(bytes(raw))
        document = MotionComposition.model_validate(frame.document)
    except ValidationError:
        raise HTTPException(422, "motion_scene_invalid") from None
    if (
        frame.scope.digest != scope_digest
        or {item.id for item in frame.scope.files} != active_media(document, frame.frame)
        or frame.frame >= document.settings.duration_frames
    ):
        raise HTTPException(422, "motion_preview_scope_invalid")
    await authorized(request, assertion)
    if state.motion_frame_slots.locked():
        raise HTTPException(429, "motion_preview_busy")
    async with state.motion_frame_slots:
        account = state.settings.account_path(actor.user_id)
        base = account / ".tmp" / "motion-previews"
        base.mkdir(parents=True, exist_ok=True, mode=0o700)
        if not base.resolve().is_relative_to(account):
            raise HTTPException(503, "motion_preview_storage_unavailable")
        with tempfile.TemporaryDirectory(dir=base, prefix="frame-") as staging:
            sources = await fetch_sources(
                request, project_id, frame.scope, assertion, Path(staging)
            )
            result = await run_sync(png, document, sources, frame.frame)
        await authorized(request, assertion)
    return Response(result, media_type="image/png", headers={"Cache-Control": "no-store"})
