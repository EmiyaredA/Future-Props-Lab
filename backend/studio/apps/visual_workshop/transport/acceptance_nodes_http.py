"""Published owned Visual node review context and scheme selection."""

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.deps import SessionDep, StudioAuth
from studio.apps.visual_workshop.acceptance.acceptance_context import AcceptanceContext
from studio.apps.visual_workshop.acceptance.http_errors import errors
from studio.apps.visual_workshop.acceptance.node_schemas import (
    AcceptanceSummaryOut,
    NodeAcceptanceOut,
    NodeAcceptanceSelectIn,
    NodeAcceptanceStartIn,
)
from studio.apps.visual_workshop.acceptance.schemas import AcceptanceRunOut
from studio.apps.visual_workshop.review.review_model import plan_executor
from studio.apps.visual_workshop.review.review_submission import ReviewSubmission
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter(prefix="/v1/visual-workshop/projects", tags=["visual-workshop"])


@router.get("/{project_id}/acceptance/summary", response_model=AcceptanceSummaryOut)
async def acceptance_summary(
    project_id: str, request: Request, session: SessionDep, principal: StudioAuth
):
    with errors():
        return await AcceptanceContext(request).nodes(session, principal).summary(project_id)


@router.get("/{project_id}/nodes/{node_id}/acceptance", response_model=NodeAcceptanceOut)
async def get_node_acceptance(
    project_id: str,
    node_id: str,
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    output_id: str | None = None,
):
    with errors():
        return (
            await AcceptanceContext(request)
            .nodes(session, principal)
            .get(project_id, node_id, output_id)
        )


@router.put("/{project_id}/nodes/{node_id}/acceptance", response_model=NodeAcceptanceOut)
async def select_node_acceptance(
    project_id: str,
    node_id: str,
    body: NodeAcceptanceSelectIn,
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
):
    with errors():
        return (
            await AcceptanceContext(request)
            .nodes(session, principal)
            .select(project_id, node_id, body)
        )


@router.post("/{project_id}/nodes/{node_id}/acceptance/runs", response_model=AcceptanceRunOut)
async def start_node_acceptance(
    project_id: str,
    node_id: str,
    body: NodeAcceptanceStartIn,
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
):
    if not principal.allows("content.write"):
        raise HTTPException(403, "需要内容写入权限")
    with errors():
        try:
            return await ReviewSubmission(request, session, principal, plan_executor).start(
                project_id, node_id, body
            )
        except CapabilityDenied as exc:
            raise HTTPException(exc.status, "验收授权已撤销") from exc
        except (CapabilityUnavailable, httpx.HTTPError) as exc:
            raise HTTPException(503, "验收依赖暂不可用") from exc
