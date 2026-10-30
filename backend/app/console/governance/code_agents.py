"""Workspace, account and purpose grants; deployment configuration stays in TOML."""

import os
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select

from app.capabilities.agents.cli.catalog import DEFINITIONS, AgentId, connection, inspect_connection
from app.capabilities.identity.errors import AccountError
from app.console.governance.governance_transactions import begin_governance, cas
from app.console.governance.platform_policy import read_setting
from app.console.governance.service import add_audit_event
from app.console.models import User, WorkspaceMembership
from app.console.models.platform_governance import PlatformSetting
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError

Purpose = Literal["amadeus", "visual_acceptance", "interview_preparation"]


class Grant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(min_length=1, max_length=36)
    agent_id: AgentId
    purpose: Purpose


class GrantUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    expected_revision: int = Field(ge=0)
    grants: list[Grant] = Field(max_length=1000)
    managed: list[str] = Field(max_length=15)


class ModelOption(BaseModel):
    id: str
    label: str


class AgentOut(BaseModel):
    id: AgentId
    name: str
    executable: str
    version: str
    enabled: bool
    available: bool
    status: str
    message: str
    models: list[ModelOption] = Field(default_factory=list)


class CatalogOut(BaseModel):
    items: list[AgentOut]


class GrantsOut(BaseModel):
    revision: int
    grants: list[Grant]
    managed: list[str]
    legacy: list[Grant]
    accounts: list[dict[str, str]]


def require_manager(principal):
    if principal.auth_kind != "session" or principal.platform_role not in {"admin", "super_admin"}:
        raise AccountError("platform_admin_required")


def legacy_grants(settings):
    result = []
    for agent_id, prefix in (("codex", "codex"), ("claude-code", "claude")):
        for user in filter(
            None, getattr(settings, f"fpl_acceptance_{prefix}_user_ids").split(os.pathsep)
        ):
            result.append(Grant(user_id=user, agent_id=agent_id, purpose="visual_acceptance"))
    if settings.fpl_interview_codex_enabled and settings.fpl_interview_codex_user_id:
        result.append(
            Grant(
                user_id=settings.fpl_interview_codex_user_id,
                agent_id="codex",
                purpose="interview_preparation",
            )
        )
    return result


async def grant_state(session, workspace_id):
    return await read_setting(session, f"code_agents:{workspace_id}", {"grants": [], "managed": []})


async def authorized(session, workspace_id, user_id, agent_id, purpose, *, settings=None):
    settings = settings or get_settings()
    state = (await grant_state(session, workspace_id))["value"]
    expected = Grant(user_id=user_id, agent_id=agent_id, purpose=purpose).model_dump()
    if f"{agent_id}:{purpose}" in state.get("managed", []):
        return expected in state["grants"]
    return expected in state["grants"] or expected in [
        g.model_dump() for g in legacy_grants(settings)
    ]


async def resolve(session, workspace_id, user_id, agent_id, purpose, *, settings=None, probe=True):
    settings = settings or get_settings()
    if not await authorized(session, workspace_id, user_id, agent_id, purpose, settings=settings):
        raise OperationError("此账号未获准使用该 Agent", "agent_not_authorized", 403)
    enabled, path, error = connection(settings, agent_id)
    if error or not enabled or not path:
        raise OperationError(error or "Agent 尚未配置", "agent_unavailable", 409)
    if probe:
        status = await inspect_connection(settings, agent_id, discover_models=False)
        if not status["available"]:
            raise OperationError(status["message"], status["status"], 409)
    return path


async def catalog(session, principal):
    result = []
    settings = get_settings()
    for identity in DEFINITIONS:
        item = await inspect_connection(settings, identity)
        allowed = await authorized(
            session,
            principal.workspace_id,
            principal.user_id,
            identity,
            "amadeus",
            settings=settings,
        )
        if not allowed and principal.platform_role not in {"admin", "super_admin"}:
            item.update(available=False, status="not_authorized", message="尚未获准用于 Amadeus")
        if principal.platform_role not in {"admin", "super_admin"}:
            item["executable"] = ""
        item["available"] = item["available"] and allowed
        result.append(AgentOut(**item))
    return CatalogOut(items=result)


async def read_grants(session, principal):
    require_manager(principal)
    state = await grant_state(session, principal.workspace_id)
    rows = (
        await session.execute(
            select(User.id, User.display_name)
            .join(WorkspaceMembership, WorkspaceMembership.user_id == User.id)
            .where(
                WorkspaceMembership.workspace_id == principal.workspace_id,
                WorkspaceMembership.status == "active",
                User.status == "active",
            )
        )
    ).all()
    ids = {row.id for row in rows}
    return GrantsOut(
        revision=state["revision"],
        **state["value"],
        legacy=[g for g in legacy_grants(get_settings()) if g.user_id in ids],
        accounts=[{"id": row.id, "name": row.display_name} for row in rows],
    )


async def save_grants(session, principal, body):
    principal = await begin_governance(session, principal)
    require_manager(principal)
    valid = {
        f"{a}:{p}"
        for a in DEFINITIONS
        for p in ("amadeus", "visual_acceptance", "interview_preparation")
        if a == "codex" or p != "interview_preparation"
    }
    if not set(body.managed) <= valid or any(
        f"{g.agent_id}:{g.purpose}" not in valid for g in body.grants
    ):
        raise OperationError("Agent 用途无效", "invalid_grant", 422)
    current = await read_grants(session, principal)
    if not set(current.managed) <= set(body.managed):
        raise OperationError("已接管用途不能重新启用旧授权", "invalid_grant", 422)
    ids = {row["id"] for row in current.accounts}
    if any(g.user_id not in ids for g in body.grants):
        raise OperationError("授权账号必须是当前空间有效成员", "invalid_grant", 422)
    if body.expected_revision != current.revision:
        raise AccountError("revision_conflict", current=current.model_dump())
    key = f"code_agents:{principal.workspace_id}"
    value = {"grants": [g.model_dump() for g in body.grants], "managed": sorted(set(body.managed))}
    row = await session.get(PlatformSetting, key)
    if row is None:
        session.add(PlatformSetting(id=key, revision=1, payload=value))
    else:
        await cas(session, PlatformSetting, key, body.expected_revision, payload=value)
    add_audit_event(
        session,
        "code_agents.grants.updated",
        actor_user_id=principal.user_id,
        metadata={"workspace_id": principal.workspace_id, "revision": current.revision + 1},
    )
    await session.commit()
    return await read_grants(session, principal)
