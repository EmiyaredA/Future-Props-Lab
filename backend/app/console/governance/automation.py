"""Explicit SDK operation discovery and account-authorized website links."""

from urllib.parse import urlencode

from studio.assembly.website.models import AUTOMATION_ROOTS
from studio.runtime.database.operation_receipts import OperationError

RESOURCE_PATHS = {
    "visual": "/apps/visual-workshop/projects/",
    "galgame": "/apps/galgame-workshop/projects/",
    "video": "/apps/video-editor/projects/",
    "presentation": "/apps/presentation-workshop/projects/",
    "annotation": "/apps/audio-annotation/projects/",
    "director": "/apps/director-desk/projects/",
    "knowledge": "/apps/thought-workshop/knowledge-bases/",
    "skill": "/integrations/skills",
    "tool-api": "/integrations/tool-apis",
    "mcp": "/integrations/mcp",
}


async def resource_link(session, principal, body):
    if body.view in {"upload", "tags", "edit", "validate"} and not principal.allows(
        "configuration.manage"
    ):
        raise OperationError("当前账号不允许配置此资源", "insufficient_permission", 403)
    row = (
        await session.get(AUTOMATION_ROOTS[body.kind], body.resource_id)
        if body.resource_id
        else None
    )
    if body.resource_id and (
        row is None
        or row.owner_user_id != principal.owner_user_id
        or getattr(row, "deleted_at", None)
    ):
        raise OperationError("资源不存在", "resource_not_found", 404)
    if body.kind == "note":
        return "/apps/thought-workshop/notes/" + body.resource_id
    base = RESOURCE_PATHS[body.kind]
    if body.kind in {"skill", "tool-api", "mcp"}:
        query = {"view": body.view}
        if body.resource_id:
            query["resource"] = body.resource_id
        return base + "?" + urlencode(query)
    suffix = {"visual": "/canvas", "galgame": "/editor"}.get(body.kind, "")
    return base + body.resource_id + suffix
