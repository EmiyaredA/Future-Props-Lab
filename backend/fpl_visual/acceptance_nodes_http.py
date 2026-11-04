"""Published owned Visual node review context and scheme selection."""

from fastapi import APIRouter, Request

from app.apps.visual_workshop.acceptance.http_errors import errors
from app.apps.visual_workshop.acceptance.node_schemas import (
    AcceptanceSummaryOut,
    NodeAcceptanceOut,
    NodeAcceptanceSelectIn,
)
from app.deps import SessionDep, StudioAuth

from .acceptance_context import AcceptanceContext

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
