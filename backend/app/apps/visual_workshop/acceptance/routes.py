from fastapi import APIRouter, HTTPException, Query

from app.apps.visual_workshop.acceptance.reviews import Reviews, repair_out
from app.apps.visual_workshop.acceptance.runs import Runs, review_models
from app.apps.visual_workshop.acceptance.schemas import (
    AcceptanceDecisionIn,
    AcceptanceModelListOut,
    AcceptanceModelOut,
    AcceptanceRepairOut,
    AcceptanceRepairWriteIn,
    AcceptanceRunCreateIn,
    AcceptanceRunListOut,
    AcceptanceRunOut,
    AcceptanceSampleIn,
    AcceptanceStandardOut,
    AcceptanceStandardWriteIn,
    AcceptanceTemplateListOut,
    AcceptanceTemplateOut,
    AcceptanceTemplateWriteIn,
)
from app.apps.visual_workshop.acceptance.standards import Standards
from app.deps import SessionDep, StudioAuth, WorkspaceDep

from .http_errors import errors
from .node_routes import router as node_router

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/acceptance-templates", response_model=AcceptanceTemplateListOut)
async def list_acceptance_templates(session: SessionDep, workspace_id: WorkspaceDep):
    return await Standards(session, workspace_id).templates()


@router.post("/acceptance-templates", response_model=AcceptanceTemplateOut)
async def create_acceptance_template(
    body: AcceptanceTemplateWriteIn, session: SessionDep, workspace_id: WorkspaceDep
):
    _ = body, session, workspace_id
    with errors():
        raise HTTPException(
            410,
            {
                "code": "acceptance_readonly",
                "message": "验收模板为固定只读定义，请在节点选择内置方案",
            },
        )


@router.put("/acceptance-templates/{template_id}", response_model=AcceptanceTemplateOut)
async def update_acceptance_template(
    template_id: str,
    body: AcceptanceTemplateWriteIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    _ = template_id, body, session, workspace_id
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_readonly", "message": "验收模板为固定只读定义"}
        )


@router.delete("/acceptance-templates/{template_id}")
async def delete_acceptance_template(
    template_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    _ = template_id, session, workspace_id, expected_revision
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_readonly", "message": "验收模板为固定只读定义"}
        )


@router.get("/projects/{project_id}/acceptance/standard", response_model=AcceptanceStandardOut)
async def get_acceptance_standard(project_id: str, session: SessionDep, workspace_id: WorkspaceDep):
    with errors():
        return await Standards(session, workspace_id).get(project_id)


@router.put("/projects/{project_id}/acceptance/standard", response_model=AcceptanceStandardOut)
async def save_acceptance_standard(
    project_id: str,
    body: AcceptanceStandardWriteIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    _ = project_id, body, session, workspace_id
    with errors():
        raise HTTPException(
            410,
            {
                "code": "acceptance_api_replaced",
                "message": "项目标准已停止发布，请在节点选择验收方案",
            },
        )


@router.get("/projects/{project_id}/acceptance/models", response_model=AcceptanceModelListOut)
async def list_acceptance_models(project_id: str, session: SessionDep, workspace_id: WorkspaceDep):
    with errors():
        await Standards(session, workspace_id).get(project_id)
        return AcceptanceModelListOut(
            items=[
                AcceptanceModelOut(
                    id=model.id,
                    label=model.label or model.slug,
                    slug=model.slug,
                    provider_name=provider.name,
                    provider_kind=provider.kind,
                )
                for model, provider in await review_models(session, workspace_id)
            ]
        )


@router.get("/projects/{project_id}/acceptance/runs", response_model=AcceptanceRunListOut)
async def list_acceptance_runs(
    project_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    node_id: str | None = None,
    page: int = Query(1, ge=1),
):
    with errors():
        return await Runs(session, workspace_id).list(project_id, node_id, page)


@router.post("/projects/{project_id}/acceptance/runs", response_model=AcceptanceRunListOut)
async def start_acceptance_runs(
    project_id: str,
    body: AcceptanceRunCreateIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    _ = project_id, body, session, workspace_id
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_api_replaced", "message": "请通过节点验收接口发起检查"}
        )


@router.get("/projects/{project_id}/acceptance/runs/{run_id}", response_model=AcceptanceRunOut)
async def get_acceptance_run(
    project_id: str, run_id: str, session: SessionDep, workspace_id: WorkspaceDep
):
    with errors():
        return await Runs(session, workspace_id).get(project_id, run_id)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/decisions", response_model=AcceptanceRunOut
)
async def decide_acceptance_run(
    project_id: str,
    run_id: str,
    body: AcceptanceDecisionIn,
    session: SessionDep,
    principal: StudioAuth,
):
    with errors():
        return await Reviews(session, principal.workspace_id).decide(
            project_id, run_id, body, principal.user_id
        )


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/cancel", response_model=AcceptanceRunOut
)
async def cancel_acceptance_run(
    project_id: str,
    run_id: str,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    expected_revision: int = Query(ge=0),
):
    with errors():
        return await Runs(session, workspace_id).cancel(project_id, run_id, expected_revision)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/samples", response_model=AcceptanceRunOut
)
async def sample_acceptance_video(
    project_id: str,
    run_id: str,
    body: AcceptanceSampleIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    with errors():
        return await Reviews(session, workspace_id).sample(project_id, run_id, body)


@router.post(
    "/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts",
    response_model=AcceptanceRepairOut,
)
async def create_acceptance_repair(
    project_id: str, run_id: str, session: SessionDep, workspace_id: WorkspaceDep
):
    with errors():
        return await Reviews(session, workspace_id).repair(project_id, run_id)


@router.get(
    "/projects/{project_id}/acceptance/repair-drafts/{draft_id}", response_model=AcceptanceRepairOut
)
async def get_acceptance_repair(
    project_id: str, draft_id: str, session: SessionDep, workspace_id: WorkspaceDep
):

    with errors():
        return repair_out(await Reviews(session, workspace_id).repair_row(project_id, draft_id))


@router.put(
    "/projects/{project_id}/acceptance/repair-drafts/{draft_id}", response_model=AcceptanceRepairOut
)
async def save_acceptance_repair(
    project_id: str,
    draft_id: str,
    body: AcceptanceRepairWriteIn,
    session: SessionDep,
    workspace_id: WorkspaceDep,
):
    with errors():
        return await Reviews(session, workspace_id).write_repair(project_id, draft_id, body)


router.include_router(node_router)
