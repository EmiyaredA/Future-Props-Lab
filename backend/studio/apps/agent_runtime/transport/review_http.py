"""Private node review intake and leased Mac transfer endpoints."""

import json
from contextlib import AsyncExitStack
from uuid import UUID

import jwt
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from starlette.background import BackgroundTask

from studio.apps.agent_runtime.transport.native_http import Lease, Receipt
from studio.contracts.identity.claims import HEADER, verify_context
from studio.contracts.identity.permissions import effective_permissions
from studio.contracts.visual_workshop.visual_agent_review import (
    JOBS,
    RESULTS,
    AgentReviewPlan,
    frame_target,
)
from studio.contracts.visual_workshop.visual_samples import FRAMES_HEADER
from studio.runtime.http.framed_media import content_length, stream_files

router = APIRouter(include_in_schema=False)
NATIVE = "/_native/v1/review"
UPLOAD = NATIVE + "/artifacts"


def review_actor(request, path):
    if request.url.path != path or "origin" in request.headers or "cookie" in request.headers:
        raise HTTPException(403, "visual_review_grant_required")
    token = request.headers.get(HEADER, "")
    try:
        actor = verify_context(
            token,
            service="agent-runtime",
            method=request.method,
            path=path,
            public_key=request.app.state.identity_public_key,
        )
    except (jwt.InvalidTokenError, ValueError, TypeError):
        raise HTTPException(401, "visual_review_grant_required") from None
    permissions = effective_permissions(actor.platform_role, frozenset(actor.scopes))
    if actor.purpose != "studio" or not {"content.write", "models.use"} <= permissions:
        raise HTTPException(403, "visual_review_forbidden")
    return actor.user_id, token


@router.post(JOBS + "/{project_id}/{run_id}/{digest}")
async def submit_review(request: Request, body: AgentReviewPlan):
    owner, token = review_actor(request, body.path)
    return await request.app.state.visual_reviews.submit(owner, token, body)


@router.post(NATIVE + "/claim")
async def claim_review(request: Request):
    return {"lease": await request.app.state.visual_reviews.claim(request.state.connection_worker)}


@router.post(NATIVE + "/authorize")
async def authorize_review(request: Request, body: Lease):
    await request.app.state.visual_reviews.authorize(request.state.connection_worker, body.lease)
    return {"active": True}


@router.post(NATIVE + "/media")
async def review_media(request: Request, body: Lease):
    stack = AsyncExitStack()
    try:
        response, length = await stack.enter_async_context(
            request.app.state.visual_reviews.media(request.state.connection_worker, body.lease)
        )
    except BaseException:
        await stack.aclose()
        raise
    return StreamingResponse(
        response.aiter_bytes(1024 * 1024),
        media_type="application/octet-stream",
        headers={"Content-Length": str(length), "Cache-Control": "private, no-store"},
        background=BackgroundTask(stack.aclose),
    )


@router.post(UPLOAD + "/{job_id}/{lease_id}/{frame_id}/{digest}")
async def upload_artifact(
    request: Request, job_id: UUID, lease_id: UUID, frame_id: str, digest: str
):
    state = request.app.state
    lease = await state.visual_reviews.artifact_lease(
        request.state.connection_worker, job_id, lease_id
    )
    await state.visual_reviews.authorize(request.state.connection_worker, lease)
    return await state.review_artifacts.store(request, lease, frame_id, digest)


@router.post(NATIVE + "/receipt")
async def settle_review(request: Request, body: Receipt):
    state = request.app.state
    await state.visual_reviews.settle(
        request.state.connection_worker, body.lease, body.outcome, state.review_artifacts
    )
    return {"acknowledged": True}


@router.get(RESULTS + "/{project_id}/{run_id}/{plan_digest}/{frame_id}/{digest}")
async def get_review_frame(request: Request):
    path = request.url.path
    if not frame_target("GET", path):
        raise HTTPException(404, "visual_review_frame_not_found")
    owner, token = review_actor(request, path)
    state = request.app.state
    job_id, lease_id, frame = await state.visual_reviews.frame(owner, token, path)
    try:
        source = await state.review_artifacts.frame(job_id, lease_id, frame)
    except ValueError as exc:
        raise HTTPException(503, "visual_review_frame_unavailable") from exc
    files = [(source, frame.byte_size)]
    return StreamingResponse(
        stream_files(files),
        media_type="application/octet-stream",
        headers={
            "Content-Length": str(content_length(files)),
            FRAMES_HEADER: json.dumps(
                [
                    {
                        "position_ms": frame.position_ms,
                        "byte_size": frame.byte_size,
                        "content_sha256": frame.sha256,
                    }
                ],
                separators=(",", ":"),
            ),
            "Cache-Control": "private, no-store",
        },
    )
