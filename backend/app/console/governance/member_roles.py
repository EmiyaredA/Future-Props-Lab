from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.principal import StudioPrincipal
from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    revoke_workspace_keys,
)
from app.console.governance.service import AccountError, add_audit_event
from app.models import WorkspaceMembership


def require_member_assignment(principal: StudioPrincipal, user_id: str, current: str, desired: str):
    if not principal.allows("members.manage"):
        raise AccountError("workspace_owner_required")
    if (
        current == "owner"
        or desired not in {"admin", "member", "viewer"}
        or user_id == principal.user_id
    ):
        raise AccountError("role_assignment_forbidden")
    if "admin" in {current, desired} and not principal.allows("members.assign_admin"):
        raise AccountError("role_assignment_forbidden")


async def update_member_role(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    membership_id: str,
    role: str,
    expected_revision: int,
    client_ip: str,
):
    principal = await begin_governance(session, principal)
    member = await session.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.id == membership_id,
            WorkspaceMembership.workspace_id == principal.workspace_id,
            WorkspaceMembership.status == "active",
        )
    )
    if member is None:
        raise AccountError("membership_not_found")
    require_member_assignment(principal, member.user_id, member.role, role)
    old = member.role
    member = await cas(session, WorkspaceMembership, member.id, expected_revision, role=role)
    await revoke_workspace_keys(session, member.user_id, principal.workspace_id)
    add_audit_event(
        session,
        "workspace.member_role_updated",
        actor_user_id=principal.user_id,
        target_user_id=member.user_id,
        workspace_id=principal.workspace_id,
        client_ip=client_ip,
        metadata={"role_from": old, "role_to": role},
    )
    await session.commit()
    return member
