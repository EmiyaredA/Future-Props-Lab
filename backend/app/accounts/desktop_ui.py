"""Authorize desktop navigation against explicit root-resource ownership."""

import secrets
import time

from app.accounts.desktop_agent import AgentError
from app.models import (
    AudioAnnotationProject,
    GalgameWorkshopProject,
    McpIntegration,
    SkillIntegration,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ToolApiIntegration,
    VideoEditorProject,
    VisualWorkshopProject,
)
from app.models.presentation_workshop import PresentationProject

ROOTS = {
    "visual": VisualWorkshopProject,
    "galgame": GalgameWorkshopProject,
    "video": VideoEditorProject,
    "presentation": PresentationProject,
    "annotation": AudioAnnotationProject,
    "note": ThoughtNote,
    "knowledge": ThoughtKnowledgeBase,
    "skill": SkillIntegration,
    "mcp": McpIntegration,
    "tool-api": ToolApiIntegration,
}


async def open_resource(runtime, session, principal, body):
    runtime.prune()
    if body.view in {"upload", "tags", "edit", "validate"} and not principal.allows(
        "configuration.manage"
    ):
        raise AgentError(403, "insufficient_permission")
    row = await session.get(ROOTS[body.kind], body.resource_id) if body.resource_id else None
    if body.resource_id and (
        row is None
        or row.workspace_id != principal.workspace_id
        or getattr(row, "deleted_at", None)
    ):
        raise AgentError(404, "resource_not_found")
    if len(runtime.ui_requests) >= 100:
        raise AgentError(429, "too_many_ui_requests")
    audience = (principal.user_id, principal.workspace_id)
    result = dict(
        id=secrets.token_hex(16),
        **body.model_dump(),
        audience=audience,
        key_id=principal.api_key_id,
        expires=time.monotonic() + 300,
        status="pending" if audience in runtime.viewers else "unavailable",
    )
    runtime.ui_requests[result["id"]] = result
    return result


def ui_request(runtime, principal, request_id):
    runtime.prune()
    row = runtime.ui_requests.get(request_id)
    if row is None or row["audience"] != (principal.user_id, principal.workspace_id):
        raise AgentError(404, "ui_request_not_found")
    if principal.auth_kind != "session" and row["key_id"] != principal.api_key_id:
        raise AgentError(404, "ui_request_not_found")
    if row["audience"] not in runtime.viewers and row["status"] in {
        "pending",
        "waiting_confirmation",
    }:
        row["status"] = "unavailable"
    return row
