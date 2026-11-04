"""Accept only scope-bound requests from the Video service."""

from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from app.capabilities.media_rendering.presets import RENDER_PRESETS
from app.capabilities.media_rendering.timeline_document import (
    VideoEditorChromaKey,
    parse_timeline_document,
)
from app.capabilities.media_rendering.timeline_ranges import timeline_duration_us
from fpl_runtime.motion_preview import sha256
from fpl_runtime.video_exports import (
    EXPORTS,
    MAX_EXPORT_REQUEST_BYTES,
    VIDEO_WORK,
    VideoImageBakeRequest,
    VideoSegmentRequest,
)
from fpl_runtime.video_processing import valid_id

router = APIRouter(include_in_schema=False)


def peer_scope(request, task_id):
    state = request.app.state
    if state.video_media_peer is None or "cookie" in request.headers or "origin" in request.headers:
        raise HTTPException(403, "video_export_peer_required")
    try:
        if str(UUID(task_id)) != task_id:
            raise ValueError("invalid id")
        owner = state.video_media_peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "video_export_peer_required") from None
    return state.video_exports, owner


def validate_scope(frozen):
    if isinstance(frozen, VideoSegmentRequest):
        return  # The typed request already binds its ordered outputs and exact originals.
    if isinstance(frozen, VideoImageBakeRequest):
        if not VideoEditorChromaKey.model_validate(frozen.image_bake).enabled:
            raise ValueError("invalid image bake")
        return
    document = parse_timeline_document(frozen.document)
    clips = [clip for track in document.tracks for clip in track.clips]
    ids = {
        identity for clip in clips for identity in (clip.asset_id, clip.font_asset_id) if identity
    }
    if (
        ids != {item.id for item in frozen.files}
        or frozen.preset not in RENDER_PRESETS
        or (frozen.transparent and frozen.preset != f"1080p{document.settings.fps}")
        or frozen.end_us > timeline_duration_us(document)
    ):
        raise ValueError("invalid frozen scope")
    if frozen.video_bake and (
        len(clips) != 1
        or clips[0].kind != "video"
        or clips[0].chroma_key is None
        or not clips[0].chroma_key.enabled
        or frozen.start_us != 0
        or frozen.preset != "1080p30"
    ):
        raise ValueError("invalid video bake")


@router.post(EXPORTS + "/{task_id}/{project_id}/{digest}")
async def submit(request: Request, task_id: str, project_id: str, digest: str):
    jobs, owner = peer_scope(request, task_id)
    if not valid_id(project_id):
        raise HTTPException(422, "video_export_project_invalid")
    raw = bytearray()
    async for chunk in request.stream():
        if len(raw) + len(chunk) > MAX_EXPORT_REQUEST_BYTES:
            raise HTTPException(413, "video_export_request_too_large")
        raw.extend(chunk)
    if sha256(raw) != digest:
        raise HTTPException(403, "video_export_document_changed")
    try:
        frozen = VIDEO_WORK.validate_json(bytes(raw))
        validate_scope(frozen)
    except (ValidationError, ValueError):
        raise HTTPException(422, "video_export_scope_invalid") from None
    try:
        return await jobs.enqueue(owner, task_id, project_id, digest, frozen)
    except ValueError:
        raise HTTPException(409, "video_export_request_conflict") from None


@router.get(EXPORTS + "/{task_id}")
async def status(request: Request, task_id: str):
    jobs, owner = peer_scope(request, task_id)
    job = await jobs.load(owner, task_id)
    if job is None:
        raise HTTPException(404, "video_export_missing")
    return jobs.receipt(job)


@router.post(EXPORTS + "/{task_id}/cancel")
async def cancel(request: Request, task_id: str):
    jobs, owner = peer_scope(request, task_id)
    job = await jobs.load(owner, task_id)
    if job is None:
        raise HTTPException(404, "video_export_missing")
    await jobs.cancel(job)
    return jobs.receipt(await jobs.load(owner, task_id))
