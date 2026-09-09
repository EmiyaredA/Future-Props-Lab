from __future__ import annotations

from datetime import timedelta

from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.governance_transactions import begin_governance, cas, revoke_workspace_keys
from app.accounts.member_roles import require_member_assignment
from app.accounts.principal import StudioPrincipal
from app.accounts.service import AccountError, add_audit_event
from app.core.time import utc_now
from app.models import (
    AuthSession,
    User,
    Workspace,
    WorkspaceInvitation,
    WorkspaceMembership,
)


async def active_membership(
    session: AsyncSession, *, user_id: str, workspace_id: str
) -> WorkspaceMembership | None:
    return await session.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.user_id == user_id,
            WorkspaceMembership.workspace_id == workspace_id,
            WorkspaceMembership.status == "active",
        )
    )


async def owner_membership(session: AsyncSession, *, user_id: str) -> WorkspaceMembership | None:
    return await session.scalar(
        select(WorkspaceMembership)
        .where(
            WorkspaceMembership.user_id == user_id,
            WorkspaceMembership.role == "owner",
            WorkspaceMembership.status == "active",
        )
        .order_by(WorkspaceMembership.created_at)
    )


async def resolve_access(
    session: AsyncSession, *, user: User, workspace: Workspace
) -> tuple[str, WorkspaceMembership | None]:
    membership = await active_membership(session, user_id=user.id, workspace_id=workspace.id)
    if membership is not None and membership.role == "owner":
        return "owner", membership
    if user.platform_role in {"admin", "super_admin"}:
        return "platform_admin", membership
    if membership is not None:
        return "member", membership
    if workspace.visibility == "public":
        return "public_viewer", None
    raise AccountError("workspace_access_changed")


async def list_workspaces(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    query: str,
    page: int,
    page_size: int,
    visibility: str = "",
) -> tuple[list[dict], int]:
    membership = WorkspaceMembership.__table__.alias("viewer_membership")
    owner_member = WorkspaceMembership.__table__.alias("owner_membership")
    owner = User.__table__.alias("owner_user")
    conditions = [owner_member.c.role == "owner", owner_member.c.status == "active"]
    if not principal.can_manage_all_workspaces:
        conditions.append(or_(membership.c.status == "active", Workspace.visibility == "public"))
    if visibility:
        conditions.append(Workspace.visibility == visibility)
    if query.strip():
        term = f"%{query.strip()}%"
        conditions.append(
            or_(
                Workspace.name.ilike(term),
                owner.c.username.ilike(term),
                owner.c.display_name.ilike(term),
            )
        )
    statement = (
        select(
            Workspace,
            membership.c.role,
            owner.c.username,
            owner.c.display_name,
        )
        .outerjoin(
            membership,
            and_(
                membership.c.workspace_id == Workspace.id,
                membership.c.user_id == principal.user_id,
                membership.c.status == "active",
            ),
        )
        .join(owner_member, owner_member.c.workspace_id == Workspace.id)
        .join(owner, owner.c.id == owner_member.c.user_id)
        .where(*conditions)
    )
    total = int(await session.scalar(select(func.count()).select_from(statement.subquery())) or 0)
    rows = (
        await session.execute(
            statement.order_by(Workspace.updated_at.desc(), Workspace.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    items: list[dict] = []
    counts = (
        dict(
            (
                await session.execute(
                    select(WorkspaceMembership.workspace_id, func.count())
                    .where(
                        WorkspaceMembership.status == "active",
                        WorkspaceMembership.workspace_id.in_([r[0].id for r in rows]),
                    )
                    .group_by(WorkspaceMembership.workspace_id)
                )
            ).all()
        )
        if rows
        else {}
    )
    for workspace, role, username, display_name in rows:
        if role == "owner":
            access = "owner"
        elif principal.can_manage_all_workspaces:
            access = "platform_admin"
        elif role in {"member", "admin", "viewer"}:
            access = "member"
        else:
            access = "public_viewer"
        items.append(
            {
                "workspace": workspace,
                "member_count": counts.get(workspace.id, 0),
                "access_kind": access,
                "role": role,
                "owner_username": username,
                "owner_display_name": display_name,
            }
        )
    return items, total


async def switch_workspace(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    workspace_id: str,
    client_ip: str,
) -> tuple[Workspace, str, WorkspaceMembership | None]:
    if principal.session_id is None:
        raise AccountError("browser_session_required")
    user = await session.get(User, principal.user_id)
    workspace = await session.get(Workspace, workspace_id)
    auth_session = await session.get(AuthSession, principal.session_id)
    if user is None or workspace is None or auth_session is None:
        raise AccountError("workspace_not_found")
    access, membership = await resolve_access(session, user=user, workspace=workspace)
    auth_session.active_workspace_id = workspace.id
    add_audit_event(
        session,
        "workspace.switched",
        actor_user_id=user.id,
        workspace_id=workspace.id,
        client_ip=client_ip,
        metadata={"access_kind": access},
    )
    await session.commit()
    return workspace, access, membership


def require_workspace_governance(principal: StudioPrincipal) -> None:
    if principal.auth_kind != "session":
        raise AccountError("browser_session_required")
    if not principal.allows("workspace.manage"):
        raise AccountError("workspace_owner_required")


async def patch_workspace(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    name: str,
    visibility: str,
    expected_revision: int,
    client_ip: str,
) -> Workspace:
    principal = await begin_governance(session, principal)
    require_workspace_governance(principal)
    workspace = await session.get(Workspace, principal.workspace_id)
    if workspace is None:
        raise AccountError("workspace_not_found")
    if workspace.revision != expected_revision:
        raise AccountError("revision_conflict", current=workspace)
    previous_visibility = workspace.visibility
    workspace = await cas(
        session,
        Workspace,
        workspace.id,
        expected_revision,
        name=name.strip(),
        visibility=visibility,
    )
    add_audit_event(
        session,
        "workspace.updated",
        actor_user_id=principal.user_id,
        workspace_id=workspace.id,
        client_ip=client_ip,
        metadata={
            "visibility_from": previous_visibility,
            "visibility_to": visibility,
        },
    )
    await session.commit()
    return workspace


async def list_members(session: AsyncSession, principal: StudioPrincipal) -> list[dict]:
    require_workspace_governance(principal)
    rows = (
        await session.execute(
            select(WorkspaceMembership, User)
            .join(User, User.id == WorkspaceMembership.user_id)
            .where(
                WorkspaceMembership.workspace_id == principal.workspace_id,
                WorkspaceMembership.status == "active",
            )
            .order_by(WorkspaceMembership.created_at, WorkspaceMembership.id)
        )
    ).all()
    return [
        {
            "membership_id": membership.id,
            "user_id": user.id,
            "username": user.username,
            "display_name": user.display_name,
            "role": membership.role,
            "revision": membership.revision,
            "joined_at": membership.created_at,
        }
        for membership, user in rows
    ]


async def remove_member(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    membership_id: str,
    expected_revision: int,
    client_ip: str,
) -> None:
    principal = await begin_governance(session, principal)
    require_workspace_governance(principal)
    membership = await session.scalar(
        select(WorkspaceMembership).where(
            WorkspaceMembership.id == membership_id,
            WorkspaceMembership.workspace_id == principal.workspace_id,
        )
    )
    if membership is None:
        raise AccountError("membership_not_found")
    require_member_assignment(principal, membership.user_id, membership.role, "member")
    if membership.revision != expected_revision:
        raise AccountError("revision_conflict", current=membership)
    membership = await cas(
        session, WorkspaceMembership, membership.id, expected_revision, status="removed"
    )
    await revoke_workspace_keys(session, membership.user_id, principal.workspace_id)
    add_audit_event(
        session,
        "workspace.member_removed",
        actor_user_id=principal.user_id,
        target_user_id=membership.user_id,
        workspace_id=principal.workspace_id,
        client_ip=client_ip,
    )
    await session.commit()


async def expire_invitations(session: AsyncSession) -> None:
    await session.execute(
        update(WorkspaceInvitation)
        .where(
            WorkspaceInvitation.status == "pending",
            WorkspaceInvitation.expires_at <= utc_now(),
        )
        .values(status="expired", responded_at=utc_now(), revision=WorkspaceInvitation.revision + 1)
    )


async def create_invitation(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    username: str,
    client_ip: str,
    role: str = "member",
) -> WorkspaceInvitation:
    principal = await begin_governance(session, principal)
    require_workspace_governance(principal)
    require_member_assignment(principal, "", "member", role)
    await expire_invitations(session)
    normalized = username.strip().lower()
    invitee = await session.scalar(
        select(User).where(
            User.username_normalized == normalized,
            User.status == "active",
            User.platform_role == "member",
        )
    )
    if invitee is None or invitee.id == principal.user_id:
        raise AccountError("invitee_not_found")
    existing_member = await active_membership(
        session, user_id=invitee.id, workspace_id=principal.workspace_id
    )
    if existing_member is not None:
        raise AccountError("already_a_member")
    pending = await session.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == principal.workspace_id,
            WorkspaceInvitation.invitee_user_id == invitee.id,
            WorkspaceInvitation.status == "pending",
        )
    )
    if pending is not None:
        raise AccountError("invitation_already_pending")
    invitation = WorkspaceInvitation(
        workspace_id=principal.workspace_id,
        invitee_user_id=invitee.id,
        invited_by_user_id=principal.user_id,
        status="pending",
        role=role,
        expires_at=utc_now() + timedelta(days=7),
    )
    session.add(invitation)
    add_audit_event(
        session,
        "workspace.invitation_created",
        actor_user_id=principal.user_id,
        target_user_id=invitee.id,
        workspace_id=principal.workspace_id,
        client_ip=client_ip,
    )
    await session.commit()
    return invitation


async def invitation_views(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    current_workspace_only: bool,
) -> list[dict]:
    if current_workspace_only:
        require_workspace_governance(principal)
    await expire_invitations(session)
    invitee = User.__table__.alias("invitee")
    inviter = User.__table__.alias("inviter")
    conditions = (
        [WorkspaceInvitation.workspace_id == principal.workspace_id]
        if current_workspace_only
        else [WorkspaceInvitation.invitee_user_id == principal.user_id]
    )
    rows = (
        await session.execute(
            select(
                WorkspaceInvitation,
                Workspace.name,
                invitee.c.username,
                invitee.c.display_name,
                inviter.c.username,
            )
            .join(Workspace, Workspace.id == WorkspaceInvitation.workspace_id)
            .join(invitee, invitee.c.id == WorkspaceInvitation.invitee_user_id)
            .outerjoin(inviter, inviter.c.id == WorkspaceInvitation.invited_by_user_id)
            .where(*conditions)
            .order_by(WorkspaceInvitation.created_at.desc())
        )
    ).all()
    await session.commit()
    return [
        {
            "id": row.id,
            "workspace_id": row.workspace_id,
            "workspace_name": workspace_name,
            "invitee_user_id": row.invitee_user_id,
            "invitee_username": invitee_username,
            "invitee_display_name": invitee_display_name,
            "inviter_username": inviter_username,
            "status": row.status,
            "role": row.role,
            "expires_at": row.expires_at,
            "responded_at": row.responded_at,
            "revision": row.revision,
            "created_at": row.created_at,
        }
        for row, workspace_name, invitee_username, invitee_display_name, inviter_username in rows
    ]


async def act_on_invitation(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    invitation_id: str,
    expected_revision: int,
    action: str,
    client_ip: str,
) -> None:
    principal = await begin_governance(session, principal)
    await expire_invitations(session)
    invitation = await session.get(WorkspaceInvitation, invitation_id)
    if invitation is None:
        raise AccountError("invitation_not_found")
    if action in {"accepted", "declined"}:
        if invitation.invitee_user_id != principal.user_id:
            raise AccountError("invitation_not_found")
    else:
        require_workspace_governance(principal)
        if invitation.workspace_id != principal.workspace_id:
            raise AccountError("invitation_not_found")
        require_member_assignment(
            principal, invitation.invitee_user_id, invitation.role, invitation.role
        )
    if invitation.revision != expected_revision:
        raise AccountError("revision_conflict", current=invitation)
    if invitation.status != "pending":
        raise AccountError("invitation_not_found")
    invitation = await cas(
        session,
        WorkspaceInvitation,
        invitation.id,
        expected_revision,
        status=action,
        responded_at=utc_now(),
    )
    if action == "accepted":
        membership = await session.scalar(
            select(WorkspaceMembership).where(
                WorkspaceMembership.user_id == principal.user_id,
                WorkspaceMembership.workspace_id == invitation.workspace_id,
            )
        )
        if membership is None:
            session.add(
                WorkspaceMembership(
                    user_id=principal.user_id,
                    workspace_id=invitation.workspace_id,
                    role=invitation.role,
                    status="active",
                )
            )
        else:
            if membership.status == "active":
                raise AccountError("already_a_member")
            await cas(
                session,
                WorkspaceMembership,
                membership.id,
                membership.revision,
                status="active",
                role=invitation.role,
            )
    add_audit_event(
        session,
        f"workspace.invitation_{action}",
        actor_user_id=principal.user_id,
        target_user_id=invitation.invitee_user_id,
        workspace_id=invitation.workspace_id,
        client_ip=client_ip,
    )
    await session.commit()
