"""Browser authority and bounded private calls for native project reveal."""

import httpx
from fastapi import HTTPException

from studio.contracts.asset_library.project_snapshots import ProjectFolderOpenOut
from studio.contracts.asset_library.reveal import APPLICATION_SERVICES, ASSETS_PREFIX, TOOLS_PREFIX
from studio.contracts.identity.claims import HEADER
from studio.contracts.identity.delegation import RequestGrant
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable


def require_local_project_request(request, principal):
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


async def open_verified_project_folder(request, session, application, project_id):
    await session.rollback()
    for service, prefix in (("assets", ASSETS_PREFIX), ("tools", TOOLS_PREFIX)):
        await _call(request, project_id, application, service, prefix)
    return ProjectFolderOpenOut()


async def _call(request, project_id, application, service, prefix):
    target = f"{prefix}/{application}/{project_id}"
    owner = APPLICATION_SERVICES[application]
    grant = RequestGrant(
        owner, f"{owner}.project.reveal", "POST", request.url.path, service, "POST", target
    )
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
