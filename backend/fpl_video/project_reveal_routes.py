"""Open the verified project folder using the original local browser authority."""

import httpx
from fastapi import APIRouter, HTTPException, Request

from app.apps.video_editor.errors import VideoEditorNotFoundError
from app.apps.video_editor.projects import VideoEditorProjects
from app.apps.video_editor.routes.errors import _error
from app.capabilities.asset_store.schemas.project_snapshots import ProjectFolderOpenOut
from app.deps import SessionDep, StudioAuth
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.project_reveal import ASSETS_PREFIX, PURPOSE, TOOLS_PREFIX

router = APIRouter()


@router.post("/projects/{project_id}/open-folder", response_model=ProjectFolderOpenOut)
async def reveal_project_folder(
    request: Request,
    principal: StudioAuth,
    session: SessionDep,
    project_id: str,
) -> ProjectFolderOpenOut:
    if principal.auth_kind != "session":
        raise HTTPException(
            403,
            {"code": "browser_session_required", "message": "打开文件夹必须使用浏览器 Session"},
        )
    if not request.state.service_actor.local:
        raise HTTPException(
            403,
            {"code": "local_access_required", "message": "请从本机网站入口打开文件夹"},
        )
    try:
        await VideoEditorProjects(session, principal.user_id).row(project_id)
    except VideoEditorNotFoundError as exc:
        raise _error(exc) from None
    await session.rollback()
    for service, prefix in (("assets", ASSETS_PREFIX), ("tools", TOOLS_PREFIX)):
        await call(request, project_id, service, prefix)
    return ProjectFolderOpenOut()


async def call(request, project_id, service, prefix):
    target = f"{prefix}/video-editor/{project_id}"
    grant = RequestGrant("video", PURPOSE, "POST", request.url.path, service, "POST", target)
    capabilities = request.app.state.capabilities
    try:
        token = await capabilities.authorize_request(request.state.service_assertion, grant)
        reply = await capabilities.client.post(
            f"http://{service}:8080" + target,
            headers={HEADER: token},
            timeout=12,
        )
        if reply.status_code in {403, 404, 409}:
            try:
                error = reply.json()
                detail = {
                    "code": str(error.get("code", "folder_open_unavailable")),
                    "message": str(error.get("detail", "项目文件夹不可用")),
                }
            except (ValueError, AttributeError):
                detail = {"code": "folder_open_unavailable", "message": "项目文件夹不可用"}
            raise HTTPException(reply.status_code, detail)
        reply.raise_for_status()
    except (httpx.HTTPError, CapabilityDenied, CapabilityUnavailable):
        raise HTTPException(
            503, {"code": "folder_open_unavailable", "message": "本机文件管理器连接不可用"}
        ) from None
