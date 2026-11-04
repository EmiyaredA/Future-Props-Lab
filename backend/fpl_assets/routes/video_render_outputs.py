"""Accept an exact Renderer-produced movie in the owning Video project scope."""

import re

from fastapi import APIRouter, HTTPException, Request

from fpl_runtime.model_outputs import ModelOutputDescription
from fpl_runtime.video_exports import OUTPUTS
from fpl_runtime.video_processing import valid_id

from ..scoped_writes import VideoFileWrites
from .library_outputs import OutputStream

router = APIRouter(include_in_schema=False)


@router.api_route(OUTPUTS + "/{project_id}/{request_id}/{digest}", methods=["GET", "POST"])
async def output(request: Request, project_id: str, request_id: str, digest: str):
    state = request.app.state
    peer = state.video_output_peer
    if (
        peer is None
        or "origin" in request.headers
        or "cookie" in request.headers
        or not valid_id(project_id)
        or not re.fullmatch(r"[a-f0-9]{32}", request_id)
        or not re.fullmatch(r"[a-f0-9]{64}", digest)
    ):
        raise HTTPException(403, "private_video_output_required")
    try:
        owner = peer.owner(request.method, request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_video_output_required") from None

    async def verified():
        permission = await state.identity.owner_permission(owner=owner, permission="content.write")
        if not permission["available"]:
            raise HTTPException(503, "identity_unavailable")
        if not permission["allowed"]:
            raise HTTPException(401, "video_output_revoked")

    async with state.database.sessions(info={"owner_user_id": owner}) as session:
        writer = VideoFileWrites(
            session, state.settings, owner, project_id, request_id, digest, active=verified
        )
        if request.method == "GET":
            previous = await writer.prior()
            if previous is None:
                raise HTTPException(404, "video_output_receipt_missing")
            return previous[0]
        if request.headers.get("content-encoding", "identity").lower() != "identity":
            raise HTTPException(422, "video_output_encoding_forbidden")
        try:
            descriptor = ModelOutputDescription.from_header(
                request.headers.get("X-Fpl-Video-Output", "")
            )
            length = int(request.headers.get("Content-Length", "-1"))
            if (
                descriptor.fingerprint != digest
                or descriptor.mime_type != "video/mp4"
                or not descriptor.filename.endswith(".mp4")
                or descriptor.byte_size != length
            ):
                raise ValueError("video output descriptor changed")
        except (TypeError, ValueError):
            raise HTTPException(422, "video_output_descriptor_invalid") from None
        if length > state.settings.fpl_project_snapshot_max_bytes:
            raise HTTPException(413, {"code": "file_too_large", "message": "成片超过保存大小限制"})
        return await writer.store_upload(
            descriptor,
            OutputStream(request, descriptor),
            max_bytes=state.settings.fpl_project_snapshot_max_bytes,
        )
