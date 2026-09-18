from __future__ import annotations

import io
from typing import Annotated

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from app.deps import SessionDep, StudioAuth, WorkspaceDep
from app.integrations.common import (
    DuplicateIntegrationError,
    IntegrationNotFoundError,
    IntegrationPermissionError,
    IntegrationValidationError,
    require_integration_owner,
)
from app.integrations.mcp import McpCatalog
from app.integrations.projections import safe_validation_catalog
from app.integrations.schemas import (
    DeleteOut,
    McpCatalogOut,
    McpCreateIn,
    McpOut,
    McpToolOut,
    McpUpdateIn,
    McpValidationOut,
    SkillCatalogOut,
    SkillOut,
    SkillTagsIn,
    SkillUpdateIn,
    SkillVersionOut,
    ToolApiCatalogOut,
    ToolApiCreateIn,
    ToolApiOut,
    ToolApiUpdateIn,
    ToolApiValidateIn,
    ToolApiValidationOut,
)
from app.integrations.skills import SkillCatalog
from app.integrations.tool_apis import ToolApiCatalog

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _owner(principal: StudioAuth) -> None:
    try:
        require_integration_owner(principal)
    except IntegrationPermissionError as exc:
        raise HTTPException(
            403,
            detail={"code": "workspace_owner_required", "message": str(exc)},
        ) from None


def _raise_integration(exc: Exception) -> None:
    if isinstance(exc, IntegrationNotFoundError):
        status, code = 404, "not_found"
    elif isinstance(exc, DuplicateIntegrationError):
        status, code = 409, "duplicate_integration"
    else:
        status, code = 422, "invalid_integration"
    raise HTTPException(status, detail={"code": code, "message": str(exc)}) from exc


@router.get("/tool-apis", response_model=ToolApiCatalogOut)
async def tool_apis(session: SessionDep, workspace_id: WorkspaceDep) -> ToolApiCatalogOut:
    return safe_validation_catalog(await ToolApiCatalog(session, workspace_id).catalog())


@router.post("/tool-apis", response_model=ToolApiOut, status_code=201)
async def create_tool_api(
    principal: StudioAuth, session: SessionDep, workspace_id: WorkspaceDep, body: ToolApiCreateIn
) -> ToolApiOut:
    _owner(principal)
    try:
        return await ToolApiCatalog(session, workspace_id).create(body)
    except DuplicateIntegrationError as exc:
        _raise_integration(exc)


@router.get("/tool-apis/{integration_id}", response_model=ToolApiOut)
async def tool_api(
    session: SessionDep, workspace_id: WorkspaceDep, integration_id: str
) -> ToolApiOut:
    try:
        return await ToolApiCatalog(session, workspace_id).get(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/tool-apis/{integration_id}", response_model=ToolApiOut)
async def update_tool_api(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    integration_id: str,
    body: ToolApiUpdateIn,
) -> ToolApiOut:
    _owner(principal)
    try:
        existing = await ToolApiCatalog(session, workspace_id).get(integration_id)
        if (
            existing.sensitive_result
            and not body.sensitive_result
            and not principal.allows("tools.sensitive")
        ):
            raise HTTPException(403, {"code": "sensitive_tool_permission_required"})
        return await ToolApiCatalog(session, workspace_id).update(integration_id, body)
    except (IntegrationNotFoundError, DuplicateIntegrationError) as exc:
        _raise_integration(exc)


@router.delete("/tool-apis/{integration_id}", response_model=DeleteOut)
async def delete_tool_api(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    integration_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await ToolApiCatalog(session, workspace_id).delete(integration_id, expected_revision)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.post("/tool-apis/{integration_id}/validate", response_model=ToolApiValidationOut)
async def validate_tool_api(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    integration_id: str,
    body: ToolApiValidateIn,
) -> ToolApiValidationOut:
    _owner(principal)
    try:
        catalog = ToolApiCatalog(session, workspace_id)
        resource = await catalog.get(integration_id)
        result = await catalog.validate(integration_id, body.input)
        if resource.sensitive_result and not principal.allows("tools.sensitive"):
            result = result.model_copy(update={"response_preview": "敏感工具内容已隐藏"})
        return result
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.get("/mcp", response_model=McpCatalogOut)
async def mcp_servers(session: SessionDep, workspace_id: WorkspaceDep) -> McpCatalogOut:
    return safe_validation_catalog(await McpCatalog(session, workspace_id).catalog())


@router.post("/mcp", response_model=McpOut, status_code=201)
async def create_mcp(
    principal: StudioAuth, session: SessionDep, workspace_id: WorkspaceDep, body: McpCreateIn
) -> McpOut:
    _owner(principal)
    try:
        return await McpCatalog(session, workspace_id).create(body)
    except DuplicateIntegrationError as exc:
        _raise_integration(exc)


@router.get("/mcp/{integration_id}", response_model=McpOut)
async def mcp_server(
    session: SessionDep, workspace_id: WorkspaceDep, integration_id: str
) -> McpOut:
    try:
        return await McpCatalog(session, workspace_id).get(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/mcp/{integration_id}", response_model=McpOut)
async def update_mcp(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    integration_id: str,
    body: McpUpdateIn,
) -> McpOut:
    _owner(principal)
    try:
        existing = await McpCatalog(session, workspace_id).get(integration_id)
        if (
            existing.sensitive_result
            and not body.sensitive_result
            and not principal.allows("tools.sensitive")
        ):
            raise HTTPException(403, {"code": "sensitive_tool_permission_required"})
        return await McpCatalog(session, workspace_id).update(integration_id, body)
    except (IntegrationNotFoundError, DuplicateIntegrationError) as exc:
        _raise_integration(exc)


@router.delete("/mcp/{integration_id}", response_model=DeleteOut)
async def delete_mcp(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    integration_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await McpCatalog(session, workspace_id).delete(integration_id, expected_revision)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.get("/mcp/{integration_id}/tools", response_model=list[McpToolOut])
async def mcp_tools(
    session: SessionDep, workspace_id: WorkspaceDep, integration_id: str
) -> list[McpToolOut]:
    try:
        return await McpCatalog(session, workspace_id).tools(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.post("/mcp/{integration_id}/validate", response_model=McpValidationOut)
async def validate_mcp(
    principal: StudioAuth, session: SessionDep, workspace_id: WorkspaceDep, integration_id: str
) -> McpValidationOut:
    _owner(principal)
    try:
        return await McpCatalog(session, workspace_id).validate(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.get("/skills", response_model=SkillCatalogOut)
async def skills(session: SessionDep, workspace_id: WorkspaceDep) -> SkillCatalogOut:
    return await SkillCatalog(session, workspace_id).catalog()


@router.post("/skills", response_model=SkillOut, status_code=201)
async def create_skill(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    file: Annotated[UploadFile, File()],
    enabled: Annotated[bool, Form()] = False,
    tags: Annotated[list[str] | None, Form(max_length=12)] = None,
) -> SkillOut:
    _owner(principal)
    try:
        return await SkillCatalog(session, workspace_id).create(
            file, enabled=enabled, tags=SkillTagsIn(tags=tags or []).tags
        )
    except (DuplicateIntegrationError, IntegrationValidationError) as exc:
        _raise_integration(exc)


@router.get("/skills/{skill_id}", response_model=SkillOut)
async def skill(session: SessionDep, workspace_id: WorkspaceDep, skill_id: str) -> SkillOut:
    try:
        return await SkillCatalog(session, workspace_id).get(skill_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/skills/{skill_id}", response_model=SkillOut)
async def update_skill(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    skill_id: str,
    body: SkillUpdateIn,
) -> SkillOut:
    _owner(principal)
    try:
        return await SkillCatalog(session, workspace_id).update(skill_id, body)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.delete("/skills/{skill_id}", response_model=DeleteOut)
async def delete_skill(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    skill_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await SkillCatalog(session, workspace_id).delete(skill_id, expected_revision)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.get("/skills/{skill_id}/versions", response_model=list[SkillVersionOut])
async def skill_versions(
    session: SessionDep, workspace_id: WorkspaceDep, skill_id: str
) -> list[SkillVersionOut]:
    try:
        return await SkillCatalog(session, workspace_id).versions(skill_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.post("/skills/{skill_id}/versions", response_model=SkillOut)
async def add_skill_version(
    principal: StudioAuth,
    session: SessionDep,
    workspace_id: WorkspaceDep,
    skill_id: str,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
) -> SkillOut:
    _owner(principal)
    try:
        return await SkillCatalog(session, workspace_id).add_version(
            skill_id, file, expected_revision=expected_revision
        )
    except (
        IntegrationNotFoundError,
        IntegrationValidationError,
        DuplicateIntegrationError,
    ) as exc:
        _raise_integration(exc)


@router.get("/skills/{skill_id}/versions/{version}/content")
async def skill_version_content(
    session: SessionDep, workspace_id: WorkspaceDep, skill_id: str, version: str
):
    try:
        filename, content = await SkillCatalog(session, workspace_id).version_zip(skill_id, version)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
