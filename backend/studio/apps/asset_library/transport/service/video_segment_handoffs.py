"""Settle an exact staged segment group for its authorized Visual owner."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from studio.contracts.video_editor.video_segment_handoff import ASSET_HANDOFFS, SegmentHandoff

router = APIRouter(include_in_schema=False)


@router.post(ASSET_HANDOFFS + "/{task_id}/{digest}/{operation}")
async def handoff(
    request: Request,
    task_id: str,
    digest: str,
    operation: Literal["inspect", "publish", "abort"],
    body: SegmentHandoff,
):
    state = request.app.state
    peer = state.visual_segment_assets_peer
    if (
        peer is None
        or "origin" in request.headers
        or "cookie" in request.headers
        or task_id != body.task_id
        or digest != body.digest
        or request.url.path != body.path(ASSET_HANDOFFS, operation)
    ):
        raise HTTPException(403, "private_segment_handoff_required")
    try:
        owner = peer.owner("POST", request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_segment_handoff_required") from None
    files = state.video_segment_handoffs
    if operation == "inspect":
        return await files.inspect(owner, body)
    return await files.settle(owner, body, publish=operation == "publish")
