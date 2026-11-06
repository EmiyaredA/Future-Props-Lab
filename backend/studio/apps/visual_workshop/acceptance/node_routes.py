from fastapi import APIRouter, HTTPException, Request

from studio.apps.model_service.transport.website.model_capacity import task_admission
from studio.apps.visual_workshop.acceptance.catalog import catalog
from studio.apps.visual_workshop.acceptance.http_errors import errors
from studio.apps.visual_workshop.acceptance.node_schemas import (
    AcceptanceSummaryOut,
    NodeAcceptanceCatalogOut,
    NodeAcceptanceOut,
    NodeAcceptanceSelectIn,
    NodeAcceptanceStartIn,
)
from studio.apps.visual_workshop.acceptance.nodes import NodeAcceptance
from studio.apps.visual_workshop.acceptance.schemas import AcceptanceRunOut
from studio.assembly.http_dependencies import SessionDep, StudioAuth

router = APIRouter()


@router.get("/acceptance/catalog", response_model=NodeAcceptanceCatalogOut)
async def acceptance_catalog(request: Request, session: SessionDep, principal: StudioAuth):
    return await catalog(
        session, principal.owner_user_id, principal.user_id, settings=request.app.state.settings
    )


@router.get("/projects/{project_id}/acceptance/summary", response_model=AcceptanceSummaryOut)
async def acceptance_summary(
    request: Request, project_id: str, session: SessionDep, principal: StudioAuth
):
    with errors():
        return await NodeAcceptance(
            session, principal.owner_user_id, principal.user_id, settings=request.app.state.settings
        ).summary(project_id)


@router.get("/projects/{project_id}/nodes/{node_id}/acceptance", response_model=NodeAcceptanceOut)
async def get_node_acceptance(
    request: Request,
    project_id: str,
    node_id: str,
    session: SessionDep,
    principal: StudioAuth,
    output_id: str | None = None,
):
    with errors():
        return await NodeAcceptance(
            session, principal.owner_user_id, principal.user_id, settings=request.app.state.settings
        ).get(project_id, node_id, output_id)


@router.put("/projects/{project_id}/nodes/{node_id}/acceptance", response_model=NodeAcceptanceOut)
async def select_node_acceptance(
    request: Request,
    project_id: str,
    node_id: str,
    body: NodeAcceptanceSelectIn,
    session: SessionDep,
    principal: StudioAuth,
):
    with errors():
        return await NodeAcceptance(
            session, principal.owner_user_id, principal.user_id, settings=request.app.state.settings
        ).select(project_id, node_id, body)


@router.post(
    "/projects/{project_id}/nodes/{node_id}/acceptance/runs", response_model=AcceptanceRunOut
)
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
        return await NodeAcceptance(
            session, principal.owner_user_id, principal.user_id, settings=request.app.state.settings
        ).start(project_id, node_id, body, task_admission(request, session, "visual_acceptance"))
