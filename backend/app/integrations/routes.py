from __future__ import annotations

import io
from pathlib import PurePosixPath
from typing import Annotated
from urllib.parse import quote
from uuid import UUID

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile
from fastapi.responses import StreamingResponse

from app.deps import OwnerDep, SessionDep, StudioAuth
from app.integrations.common import (
    DuplicateIntegrationError,
    IntegrationNotFoundError,
    IntegrationPermissionError,
    IntegrationValidationError,
    require_integration_owner,
)
from app.integrations.http_bindings import mcp_catalog, skill_catalog, tool_catalog
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
    SkillFileListOut,
    SkillFileTextOut,
    SkillMarkdownOut,
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
    ValidationAttemptListOut,
    ValidationReconcileOut,
)

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _owner(principal: StudioAuth) -> None:
    try:
        require_integration_owner(principal)
    except IntegrationPermissionError as exc:
        raise HTTPException(
            403,
            detail={"code": "account_access_required", "message": str(exc)},
        ) from None


def _raise_integration(exc: Exception) -> None:
    if isinstance(exc, IntegrationNotFoundError):
        status, code = 404, "not_found"
    elif isinstance(exc, DuplicateIntegrationError):
        status, code = 409, "duplicate_integration"
    else:
        status, code = 422, "invalid_integration"
    raise HTTPException(status, detail={"code": code, "message": str(exc)}) from exc


@router.get("/validation-attempts", response_model=ValidationAttemptListOut)
async def validation_attempts(
    request: Request,
    principal: StudioAuth,
    owner_user_id: OwnerDep,
    offset: int = Query(0, ge=0),
):
    _owner(principal)
    recovery = getattr(request.app.state, "integration_validation_recovery", None)
    if recovery is None:
        return ValidationAttemptListOut(items=[])
    return await recovery.list_pending(owner_user_id, offset=offset)


@router.post("/validation-attempts/{attempt_id}/reconcile", response_model=ValidationReconcileOut)
async def reconcile_validation(
    request: Request, principal: StudioAuth, owner_user_id: OwnerDep, attempt_id: UUID
):
    _owner(principal)
    recovery = getattr(request.app.state, "integration_validation_recovery", None)
    if recovery is None:
        raise HTTPException(
            404, {"code": "integration_validation_not_found", "message": "验证记录不存在"}
        )
    return await recovery.reconcile(owner_user_id, str(attempt_id))


@router.get("/tool-apis", response_model=ToolApiCatalogOut)
async def tool_apis(
    request: Request, session: SessionDep, owner_user_id: OwnerDep
) -> ToolApiCatalogOut:
    return safe_validation_catalog(await tool_catalog(request, session, owner_user_id).catalog())


@router.post("/tool-apis", response_model=ToolApiOut, status_code=201)
async def create_tool_api(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: ToolApiCreateIn,
) -> ToolApiOut:
    _owner(principal)
    try:
        return await tool_catalog(request, session, owner_user_id).create(body)
    except DuplicateIntegrationError as exc:
        _raise_integration(exc)


@router.get("/tool-apis/{integration_id}", response_model=ToolApiOut)
async def tool_api(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, integration_id: str
) -> ToolApiOut:
    try:
        return await tool_catalog(request, session, owner_user_id).get(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/tool-apis/{integration_id}", response_model=ToolApiOut)
async def update_tool_api(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
    body: ToolApiUpdateIn,
) -> ToolApiOut:
    _owner(principal)
    try:
        existing = await tool_catalog(request, session, owner_user_id).get(integration_id)
        if (
            existing.sensitive_result
            and not body.sensitive_result
            and not principal.allows("tools.sensitive")
        ):
            raise HTTPException(403, {"code": "sensitive_tool_permission_required"})
        return await tool_catalog(request, session, owner_user_id).update(integration_id, body)
    except (IntegrationNotFoundError, DuplicateIntegrationError) as exc:
        _raise_integration(exc)


@router.delete("/tool-apis/{integration_id}", response_model=DeleteOut)
async def delete_tool_api(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await tool_catalog(request, session, owner_user_id).delete(
            integration_id, expected_revision
        )
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.post("/tool-apis/{integration_id}/validate", response_model=ToolApiValidationOut)
async def validate_tool_api(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
    body: ToolApiValidateIn,
) -> ToolApiValidationOut:
    _owner(principal)
    try:
        catalog = tool_catalog(request, session, owner_user_id)
        resource = await catalog.get(integration_id)
        result = await catalog.validate(integration_id, body.input)
        if resource.sensitive_result and not principal.allows("tools.sensitive"):
            result = result.model_copy(update={"response_preview": "敏感工具内容已隐藏"})
        return result
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.get("/mcp", response_model=McpCatalogOut)
async def mcp_servers(
    request: Request, session: SessionDep, owner_user_id: OwnerDep
) -> McpCatalogOut:
    return safe_validation_catalog(await mcp_catalog(request, session, owner_user_id).catalog())


@router.post("/mcp", response_model=McpOut, status_code=201)
async def create_mcp(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    body: McpCreateIn,
) -> McpOut:
    _owner(principal)
    try:
        return await mcp_catalog(request, session, owner_user_id).create(body)
    except DuplicateIntegrationError as exc:
        _raise_integration(exc)


@router.get("/mcp/{integration_id}", response_model=McpOut)
async def mcp_server(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, integration_id: str
) -> McpOut:
    try:
        return await mcp_catalog(request, session, owner_user_id).get(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/mcp/{integration_id}", response_model=McpOut)
async def update_mcp(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
    body: McpUpdateIn,
) -> McpOut:
    _owner(principal)
    try:
        existing = await mcp_catalog(request, session, owner_user_id).get(integration_id)
        if (
            existing.sensitive_result
            and not body.sensitive_result
            and not principal.allows("tools.sensitive")
        ):
            raise HTTPException(403, {"code": "sensitive_tool_permission_required"})
        return await mcp_catalog(request, session, owner_user_id).update(integration_id, body)
    except (IntegrationNotFoundError, DuplicateIntegrationError) as exc:
        _raise_integration(exc)


@router.delete("/mcp/{integration_id}", response_model=DeleteOut)
async def delete_mcp(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await mcp_catalog(request, session, owner_user_id).delete(integration_id, expected_revision)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.get("/mcp/{integration_id}/tools", response_model=list[McpToolOut])
async def mcp_tools(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, integration_id: str
) -> list[McpToolOut]:
    try:
        return await mcp_catalog(request, session, owner_user_id).tools(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.post("/mcp/{integration_id}/validate", response_model=McpValidationOut)
async def validate_mcp(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    integration_id: str,
) -> McpValidationOut:
    _owner(principal)
    try:
        return await mcp_catalog(request, session, owner_user_id).validate(integration_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.get("/skills", response_model=SkillCatalogOut)
async def skills(request: Request, session: SessionDep, owner_user_id: OwnerDep) -> SkillCatalogOut:
    return await skill_catalog(request, session, owner_user_id).catalog()


@router.post("/skills", response_model=SkillOut, status_code=201)
async def create_skill(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    file: Annotated[UploadFile, File()],
    enabled: Annotated[bool, Form()] = False,
    tags: Annotated[list[str] | None, Form(max_length=12)] = None,
) -> SkillOut:
    _owner(principal)
    try:
        return await skill_catalog(request, session, owner_user_id).create(
            file, enabled=enabled, tags=SkillTagsIn(tags=tags or []).tags
        )
    except (DuplicateIntegrationError, IntegrationValidationError) as exc:
        _raise_integration(exc)


@router.get("/skills/{skill_id}", response_model=SkillOut)
async def skill(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, skill_id: str
) -> SkillOut:
    try:
        return await skill_catalog(request, session, owner_user_id).get(skill_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.patch("/skills/{skill_id}", response_model=SkillOut)
async def update_skill(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    skill_id: str,
    body: SkillUpdateIn,
) -> SkillOut:
    _owner(principal)
    try:
        return await skill_catalog(request, session, owner_user_id).update(skill_id, body)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.delete("/skills/{skill_id}", response_model=DeleteOut)
async def delete_skill(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    skill_id: str,
    expected_revision: int = Query(ge=0),
) -> DeleteOut:
    _owner(principal)
    try:
        await skill_catalog(request, session, owner_user_id).delete(skill_id, expected_revision)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return DeleteOut()


@router.get("/skills/{skill_id}/versions", response_model=list[SkillVersionOut])
async def skill_versions(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, skill_id: str
) -> list[SkillVersionOut]:
    try:
        return await skill_catalog(request, session, owner_user_id).versions(skill_id)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.post("/skills/{skill_id}/versions", response_model=SkillOut)
async def add_skill_version(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    owner_user_id: OwnerDep,
    skill_id: str,
    file: Annotated[UploadFile, File()],
    expected_revision: Annotated[int, Form(ge=0)],
) -> SkillOut:
    _owner(principal)
    try:
        return await skill_catalog(request, session, owner_user_id).add_version(
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
    request: Request, session: SessionDep, owner_user_id: OwnerDep, skill_id: str, version: str
):
    try:
        filename, content = await skill_catalog(request, session, owner_user_id).version_zip(
            skill_id, version
        )
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/skills/{skill_id}/versions/{version}/files", response_model=SkillFileListOut)
async def skill_version_files(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, skill_id: str, version: str
) -> SkillFileListOut:
    try:
        return await skill_catalog(request, session, owner_user_id).version_files(skill_id, version)
    except IntegrationNotFoundError as exc:
        _raise_integration(exc)


@router.get(
    "/skills/{skill_id}/versions/{version}/files/content",
    response_model=SkillFileTextOut,
)
async def skill_version_file_content(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    skill_id: str,
    version: str,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
) -> SkillFileTextOut:
    try:
        return await skill_catalog(request, session, owner_user_id).version_file_text(
            skill_id, version, path
        )
    except (IntegrationNotFoundError, IntegrationValidationError) as exc:
        _raise_integration(exc)


@router.get("/skills/{skill_id}/versions/{version}/files/media")
async def skill_version_file_media(
    request: Request,
    session: SessionDep,
    owner_user_id: OwnerDep,
    skill_id: str,
    version: str,
    path: Annotated[str, Query(min_length=1, max_length=1024)],
):
    try:
        catalog = skill_catalog(request, session, owner_user_id)
        filename, content, media_type = await catalog.version_file_image(skill_id, version, path)
    except (IntegrationNotFoundError, IntegrationValidationError) as exc:
        _raise_integration(exc)
    safe_name = quote(PurePosixPath(filename).name, safe="")
    return StreamingResponse(
        io.BytesIO(content),
        media_type=media_type,
        headers={"Content-Disposition": f"inline; filename*=UTF-8''{safe_name}"},
    )


@router.get("/skills/{skill_id}/versions/{version}/skill-md", response_model=SkillMarkdownOut)
async def skill_version_markdown(
    request: Request, session: SessionDep, owner_user_id: OwnerDep, skill_id: str, version: str
) -> SkillMarkdownOut:
    try:
        return await skill_catalog(request, session, owner_user_id).version_markdown(
            skill_id, version
        )
    except (IntegrationNotFoundError, IntegrationValidationError) as exc:
        _raise_integration(exc)
