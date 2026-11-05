"""Move one completed Motion movie to Video without re-encoding or foreign mounts."""

import re
from dataclasses import asdict

import httpx
from anyio.to_thread import run_sync
from fastapi import APIRouter, HTTPException, Request

from app.capabilities.media_rendering.motion_outputs import OUTPUT_NAMES
from studio.contracts.video_editor.video_assets import VideoAsset
from studio.contracts.video_editor.video_handoff import MOVIE_TYPES, NONCE, TRANSFERS, UUID
from studio.runtime.files.signed_payloads import ModelOutputDescription

router = APIRouter(include_in_schema=False)


def owned_request(request, source_id, format_name):
    peer = request.app.state.video_media_peer
    if (
        peer is None
        or "cookie" in request.headers
        or "origin" in request.headers
        or not re.fullmatch(NONCE, source_id)
        or format_name not in MOVIE_TYPES
    ):
        raise HTTPException(403, "private_motion_transfer_required")
    try:
        return peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_motion_transfer_required") from None


async def owned_movie(state, owner, source_id, format_name):
    jobs = state.motion_jobs
    job = await jobs.load(owner, source_id)
    filename = OUTPUT_NAMES[format_name]
    if job is None or job.status != "completed" or job.outputs.get(format_name) != filename:
        raise HTTPException(404, "motion_movie_missing")
    folder = jobs.folder(owner, source_id) / "outputs"
    movie = folder / filename
    if movie.is_symlink() or not movie.resolve().is_relative_to(folder) or not movie.is_file():
        raise HTTPException(404, "motion_movie_missing")
    return movie, filename


@router.get(TRANSFERS + "/prepare/{source_id}/{format_name}")
async def prepare(request: Request, source_id: str, format_name: str):
    owner = owned_request(request, source_id, format_name)
    movie, filename = await owned_movie(request.app.state, owner, source_id, format_name)
    try:
        descriptor = await run_sync(
            ModelOutputDescription.from_file, movie, filename, MOVIE_TYPES[format_name]
        )
    except (ValueError, OSError):
        raise HTTPException(404, "motion_movie_missing") from None
    return asdict(descriptor)


@router.post(TRANSFERS + "/{intent_id}/{project_id}/{source_id}/{format_name}/{digest}")
async def transfer(
    request: Request, intent_id: str, project_id: str, source_id: str, format_name: str, digest: str
):
    owner = owned_request(request, source_id, format_name)
    if not re.fullmatch(NONCE, intent_id) or not re.fullmatch(UUID, project_id):
        raise HTTPException(422, "invalid_motion_transfer_scope")
    try:
        descriptor = ModelOutputDescription.from_header(
            request.headers.get("X-Fpl-Video-Output", "")
        )
    except ValueError:
        raise HTTPException(422, "invalid_motion_transfer_description") from None
    if (
        descriptor.fingerprint != digest
        or descriptor.filename != OUTPUT_NAMES[format_name]
        or descriptor.mime_type != MOVIE_TYPES[format_name]
    ):
        raise HTTPException(422, "motion_transfer_description_changed")
    state = request.app.state
    outputs = state.video_exports.outputs
    try:
        reply = await outputs.lookup(owner, project_id, intent_id, descriptor)
        if reply.status_code == 404:
            movie, _ = await owned_movie(state, owner, source_id, format_name)
            reply = await outputs.publish(owner, project_id, intent_id, descriptor, movie)
        if reply.status_code in {401, 403, 404, 409, 413, 422}:
            raise HTTPException(reply.status_code, "motion_transfer_rejected")
        reply.raise_for_status()
        result = VideoAsset.model_validate(reply.json())
        if result.byte_size != descriptor.byte_size or result.mime_type != descriptor.mime_type:
            raise ValueError("motion transfer receipt mismatch")
    except (httpx.HTTPError, ValueError, OSError):
        raise HTTPException(503, "motion_transfer_receipt_unavailable") from None
    return result
