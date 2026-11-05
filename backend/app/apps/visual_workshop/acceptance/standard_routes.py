from fastapi import APIRouter, HTTPException, Query

from app.deps import OwnerDep, SessionDep

from .http_errors import errors
from .schemas import (
    AcceptanceRunCreateIn,
    AcceptanceRunListOut,
    AcceptanceStandardOut,
    AcceptanceStandardWriteIn,
    AcceptanceTemplateListOut,
    AcceptanceTemplateOut,
    AcceptanceTemplateWriteIn,
)
from .standards import Standards

router = APIRouter(prefix="/visual-workshop", tags=["visual-workshop"])


@router.get("/acceptance-templates", response_model=AcceptanceTemplateListOut)
async def list_acceptance_templates(session: SessionDep, owner_user_id: OwnerDep):
    return await Standards(session, owner_user_id).templates()


@router.post("/acceptance-templates", response_model=AcceptanceTemplateOut)
async def create_acceptance_template(
    body: AcceptanceTemplateWriteIn, session: SessionDep, owner_user_id: OwnerDep
):
    _ = body, session, owner_user_id
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
    owner_user_id: OwnerDep,
):
    _ = template_id, body, session, owner_user_id
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_readonly", "message": "验收模板为固定只读定义"}
        )


@router.delete("/acceptance-templates/{template_id}")
async def delete_acceptance_template(
    template_id: str,
    session: SessionDep,
    owner_user_id: OwnerDep,
    expected_revision: int = Query(ge=0),
) -> dict[str, bool]:
    _ = template_id, session, owner_user_id, expected_revision
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_readonly", "message": "验收模板为固定只读定义"}
        )


@router.get("/projects/{project_id}/acceptance/standard", response_model=AcceptanceStandardOut)
async def get_acceptance_standard(project_id: str, session: SessionDep, owner_user_id: OwnerDep):
    with errors():
        return await Standards(session, owner_user_id).get(project_id)


@router.put("/projects/{project_id}/acceptance/standard", response_model=AcceptanceStandardOut)
async def save_acceptance_standard(
    project_id: str,
    body: AcceptanceStandardWriteIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    _ = project_id, body, session, owner_user_id
    with errors():
        raise HTTPException(
            410,
            {
                "code": "acceptance_api_replaced",
                "message": "项目标准已停止发布，请在节点选择验收方案",
            },
        )


@router.post("/projects/{project_id}/acceptance/runs", response_model=AcceptanceRunListOut)
async def start_acceptance_runs(
    project_id: str,
    body: AcceptanceRunCreateIn,
    session: SessionDep,
    owner_user_id: OwnerDep,
):
    _ = project_id, body, session, owner_user_id
    with errors():
        raise HTTPException(
            410, {"code": "acceptance_api_replaced", "message": "请通过节点验收接口发起检查"}
        )
