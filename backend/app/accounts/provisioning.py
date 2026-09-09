from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.governance_transactions import begin_governance, require_platform_admin
from app.accounts.model_templates import initialize_from_template
from app.accounts.passwords import generate_temporary_password, hash_password, normalize_username
from app.accounts.service import AccountError, add_audit_event
from app.core.tenant_context import bind_workspace
from app.llm.catalog.seed import ensure_workspace_model_catalog
from app.models import User, Workspace, WorkspaceMembership
from app.models.workspace import DEFAULT_WORKSPACE_ID


async def create_account(
    session: AsyncSession,
    *,
    username: str,
    display_name: str,
    is_platform_admin: bool,
    actor_user_id: str | None = None,
    client_ip: str = "",
    email: str | None = None,
    platform_role: str | None = None,
    password: str | None = None,
    commit: bool = True,
) -> tuple[User, Workspace, str]:
    """Provision the account, ownership and initial catalog in one transaction."""
    role = platform_role or ("super_admin" if is_platform_admin else "member")
    if role not in {"super_admin", "admin", "member"}:
        raise AccountError("invalid_platform_role")
    is_platform_admin = role == "super_admin"
    try:
        normalized = normalize_username(username)
        exists = await session.scalar(select(User.id).where(User.username_normalized == normalized))
        if exists:
            raise AccountError("username_conflict")
        normalized_email = (email or "").strip()
        if normalized_email and ("@" not in normalized_email or len(normalized_email) > 254):
            raise AccountError("invalid_email")
        temporary_password = generate_temporary_password()
        user = User(
            username=username.strip(),
            username_normalized=normalized,
            display_name=display_name.strip() or username.strip(),
            password_hash=hash_password(password or temporary_password),
            email=normalized_email or None,
            email_normalized=normalized_email.casefold() or None,
            is_platform_admin=is_platform_admin,
            platform_role=role,
            must_change_password=password is None,
        )
        session.add(user)
        await session.flush()

        workspace: Workspace | None = None
        if is_platform_admin:
            claimed = await session.scalar(
                select(WorkspaceMembership.id).where(
                    WorkspaceMembership.workspace_id == DEFAULT_WORKSPACE_ID,
                    WorkspaceMembership.role == "owner",
                    WorkspaceMembership.status == "active",
                )
            )
            if claimed is None:
                workspace = await session.get(Workspace, DEFAULT_WORKSPACE_ID)
        created_workspace = workspace is None
        if workspace is None:
            workspace = Workspace(name=f"{user.display_name} 的工作区")
            session.add(workspace)
            await session.flush()
        session.add(
            WorkspaceMembership(
                user_id=user.id,
                workspace_id=workspace.id,
                role="owner",
                status="active",
            )
        )
        add_audit_event(
            session,
            "account.created",
            actor_user_id=actor_user_id,
            target_user_id=user.id,
            workspace_id=workspace.id,
            client_ip=client_ip,
            metadata={"platform_admin": is_platform_admin},
        )
        if created_workspace:
            await initialize_workspace_catalog(session, workspace.id, role)
        if commit:
            await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AccountError("account_conflict") from exc
    except Exception:
        await session.rollback()
        raise
    await session.refresh(user)
    return user, workspace, temporary_password


async def create_workspace(
    session: AsyncSession,
    principal,
    *,
    name: str,
    owner_user_id: str,
    visibility: str,
    client_ip: str,
) -> Workspace:
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    owner = await session.get(User, owner_user_id)
    if owner is None or owner.status != "active":
        raise AccountError("owner_not_found")
    workspace = Workspace(name=name.strip(), visibility=visibility)
    session.add(workspace)
    await session.flush()
    session.add(
        WorkspaceMembership(
            user_id=owner.id, workspace_id=workspace.id, role="owner", status="active"
        )
    )
    await initialize_workspace_catalog(session, workspace.id, owner.platform_role)
    add_audit_event(
        session,
        "workspace.created",
        actor_user_id=principal.user_id,
        target_user_id=owner.id,
        workspace_id=workspace.id,
        client_ip=client_ip,
    )
    await session.commit()
    return workspace


async def initialize_workspace_catalog(
    session: AsyncSession, workspace_id: str, role: str = "member"
) -> None:
    # Only called for the workspace created/claimed by the authorized provisioning use case.
    previous = session.info.get("workspace_id")
    bind_workspace(session, workspace_id)
    try:
        if not await initialize_from_template(session, workspace_id, role):
            await ensure_workspace_model_catalog(session, workspace_id)
        await session.flush()
    finally:
        if previous is not None:
            bind_workspace(session, previous)
        else:
            session.info.pop("workspace_id", None)


async def create_managed_account(
    session,
    principal,
    *,
    username,
    display_name,
    email,
    is_platform_admin,
    client_ip,
    platform_role=None,
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    return await create_account(
        session,
        username=username,
        display_name=display_name,
        email=email,
        is_platform_admin=is_platform_admin,
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        platform_role=platform_role,
    )
