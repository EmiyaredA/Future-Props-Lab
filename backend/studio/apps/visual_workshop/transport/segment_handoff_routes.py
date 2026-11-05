"""Apply an exact signed Video-to-Visual handoff operation."""

from typing import Literal

from fastapi import APIRouter, HTTPException, Request

from studio.contracts.video_editor.video_segment_handoff import VISUAL_HANDOFFS, SegmentHandoff

router = APIRouter(include_in_schema=False)


@router.post(VISUAL_HANDOFFS + "/{task_id}/{digest}/{operation}")
async def handoff(
    request: Request,
    task_id: str,
    digest: str,
    operation: Literal["prepare", "commit", "abort"],
    body: SegmentHandoff,
):
    state = request.app.state
    peer = state.video_segment_peer
    if (
        peer is None
        or "origin" in request.headers
        or "cookie" in request.headers
        or task_id != body.task_id
        or digest != body.digest
        or request.url.path != body.path(VISUAL_HANDOFFS, operation)
    ):
        raise HTTPException(403, "private_segment_handoff_required")
    try:
        owner = peer.owner("POST", request.url.path, request.headers)
    except ValueError:
        raise HTTPException(403, "private_segment_handoff_required") from None
    operations = state.segment_handoffs
    if operation == "prepare":
        return await operations.prepare(owner, body)
    if operation == "commit":
        return await operations.commit(owner, body)
    return await operations.abort(owner, body)
