"""Receive a Rendering peer's signed, byte-bounded MP4 group."""

import re

from fastapi import APIRouter, HTTPException, Request

from fpl_runtime.video_processing import valid_id
from fpl_runtime.video_segments import OUTPUTS, SegmentBatchManifest, segment_receipt_id

from ..video_segment_files import SegmentBody, SegmentFileWrites

router = APIRouter(include_in_schema=False)


@router.api_route(OUTPUTS + "/{project_id}/{task_id}/{digest}", methods=["GET", "POST"])
async def output(request: Request, project_id: str, task_id: str, digest: str):
    state, method = request.app.state, request.method
    peer = state.video_output_peer
    if (
        peer is None
        or "origin" in request.headers
        or "cookie" in request.headers
        or not valid_id(project_id)
        or not re.fullmatch(r"[a-f0-9]{64}", digest)
    ):
        raise HTTPException(403, "private_video_segment_output_required")
    try:
        receipt_id = segment_receipt_id(task_id)
        owner = peer.owner(method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_video_segment_output_required") from None

    async def active():
        permission = await state.identity.owner_permission(owner=owner, permission="content.write")
        if not permission["available"]:
            raise HTTPException(503, "identity_unavailable")
        if not permission["allowed"]:
            raise HTTPException(401, "video_segment_output_revoked")

    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        writer = SegmentFileWrites(
            session, state.settings, owner, project_id, receipt_id, digest, active=active
        )
        if method == "GET":
            receipt = await writer.prior()
            if receipt is None:
                raise HTTPException(404, "video_segment_output_missing")
            return {"items": receipt}
        return {"items": await publish(request, writer, digest, state.settings)}


async def publish(request, writer, digest, settings):
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(422, "video_segment_encoding_forbidden")
    body = SegmentBody(request.stream())
    try:
        try:
            manifest_length = int(request.headers.get("X-Fpl-Manifest-Length", "-1"))
            length = int(request.headers.get("Content-Length", "-1"))
            raw = await body.manifest_bytes(manifest_length)
            manifest = SegmentBatchManifest.model_validate_json(raw)
            if manifest.digest != digest or length != manifest_length + manifest.byte_size:
                raise ValueError("segment group digest or length differs")
        except (TypeError, ValueError):
            raise HTTPException(422, "video_segment_output_changed") from None
        limit = settings.fpl_visual_asset_max_bytes
        if manifest.byte_size > settings.fpl_project_snapshot_max_bytes or any(
            file.byte_size > limit for file in manifest.files
        ):
            raise HTTPException(413, "video_segment_output_too_large")
        return await writer.publish(manifest, body, limit)
    finally:
        await body.close()
