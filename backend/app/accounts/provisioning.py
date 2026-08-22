from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.accounts.passwords import generate_temporary_password, hash_password, normalize_username
from app.accounts.service import AccountError, add_audit_event
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
) -> tuple[User, Workspace, str]:
    """Provision the account, ownership and initial catalog in one transaction."""
    try:
        normalized = normalize_username(username)
        exists = await session.scalar(select(User.id).where(User.username_normalized == normalized))
        if exists:
            raise AccountError("username_conflict")
        temporary_password = generate_temporary_password()
        user = User(
            username=username.strip(),
            username_normalized=normalized,
            display_name=display_name.strip() or username.strip(),
            password_hash=hash_password(temporary_password),
            is_platform_admin=is_platform_admin,
            must_change_password=True,
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
            await ensure_workspace_model_catalog(session, workspace.id)
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    await session.refresh(user)
    return user, workspace, temporary_password
