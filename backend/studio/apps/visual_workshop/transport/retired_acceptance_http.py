"""Retired review APIs return an explicit response without reading historical evidence."""

from fastapi import APIRouter, HTTPException, Request

from studio.apps.visual_workshop.projects import Projects
from studio.apps.visual_workshop.transport.project_errors import resolve
from studio.assembly.http_dependencies import OwnerDep, SessionDep

router = APIRouter(include_in_schema=False)


def retired():
    raise HTTPException(
        410,
        {
            "code": "visual_acceptance_retired",
            "message": "自动验收功能已移除；请使用节点的手动通过标记。",
        },
    )


@router.get("/visual-workshop/projects/{project_id}/acceptance/models")
@router.get("/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}")
@router.put("/visual-workshop/projects/{project_id}/acceptance/repair-drafts/{draft_id}")
@router.get("/visual-workshop/projects/{project_id}/acceptance/runs")
@router.post("/visual-workshop/projects/{project_id}/acceptance/runs")
@router.get("/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}")
@router.post("/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/cancel")
@router.post("/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/decisions")
@router.post("/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/repair-drafts")
@router.post("/visual-workshop/projects/{project_id}/acceptance/runs/{run_id}/samples")
@router.get("/visual-workshop/projects/{project_id}/acceptance/standard")
@router.put("/visual-workshop/projects/{project_id}/acceptance/standard")
@router.get("/visual-workshop/projects/{project_id}/acceptance/summary")
@router.get("/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance")
@router.put("/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance")
@router.post("/visual-workshop/projects/{project_id}/nodes/{node_id}/acceptance/runs")
async def retired_project_review(request: Request, session: SessionDep, owner: OwnerDep):
    await resolve(Projects(session, owner).row(request.path_params["project_id"]))
    retired()


@router.get("/visual-workshop/acceptance-templates")
@router.post("/visual-workshop/acceptance-templates")
@router.delete("/visual-workshop/acceptance-templates/{template_id}")
@router.put("/visual-workshop/acceptance-templates/{template_id}")
@router.get("/visual-workshop/acceptance/catalog")
async def retired_review_catalog(_owner: OwnerDep):
    retired()
