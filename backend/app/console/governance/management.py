"""Platform governance, using the same provisioning rules as account recovery."""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.principal import StudioPrincipal
from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    require_platform_admin,
    revoke_account_credentials,
)
from app.console.governance.service import AccountError, add_audit_event, reset_password
from app.models import User


async def account_page(
    session: AsyncSession,
    *,
    q: str = "",
    status: str = "",
    is_platform_admin: bool | None = None,
    platform_role: str = "",
    page: int = 1,
    page_size: int = 25,
):
    conditions = []
    if q.strip():
        term = f"%{q.strip()}%"
        conditions.append(
            or_(User.username.ilike(term), User.display_name.ilike(term), User.email.ilike(term))
        )
    if status:
        conditions.append(User.status == status)
    if is_platform_admin is not None:
        conditions.append(User.is_platform_admin == is_platform_admin)
    if platform_role:
        conditions.append(User.platform_role == platform_role)
    total = await session.scalar(select(func.count()).select_from(User).where(*conditions))
    rows = (
        await session.scalars(
            select(User)
            .where(*conditions)
            .order_by(User.created_at.desc(), User.id)
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return rows, int(total or 0)


async def update_account(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    user_id: str,
    expected_revision: int,
    status: str | None,
    is_platform_admin: bool | None,
    client_ip: str,
    platform_role: str | None = None,
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    user = await session.get(User, user_id)
    if user is None:
        raise AccountError("account_not_found")
    next_status = status if status is not None else user.status
    next_role = platform_role or (
        ("super_admin" if is_platform_admin else "member")
        if is_platform_admin is not None
        else user.platform_role
    )
    next_admin = next_role == "super_admin"
    if user.id == principal.user_id and (next_status == "disabled" or not next_admin):
        raise AccountError("cannot_disable_or_demote_self")
    if (
        user.platform_role == "super_admin"
        and user.status == "active"
        and (not next_admin or next_status == "disabled")
    ):
        count = await session.scalar(
            select(func.count())
            .select_from(User)
            .where(User.platform_role == "super_admin", User.status == "active")
        )
        if int(count or 0) <= 1:
            raise AccountError("last_platform_admin")
    role_changed = user.platform_role != next_role
    previous = {"status_from": user.status, "platform_role_from": user.platform_role}
    user = await cas(
        session,
        User,
        user.id,
        expected_revision,
        status=next_status,
        is_platform_admin=next_admin,
        platform_role=next_role,
    )
    if role_changed or next_status == "disabled":
        await revoke_account_credentials(session, user.id)
    add_audit_event(
        session,
        "account.updated",
        actor_user_id=principal.user_id,
        target_user_id=user.id,
        client_ip=client_ip,
        metadata={**previous, "status_to": next_status, "platform_role_to": next_role},
    )
    await session.commit()
    return user


async def reset_account_password(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    user_id: str,
    expected_revision: int,
    client_ip: str,
):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    user = await session.get(User, user_id)
    if user is None:
        raise AccountError("account_not_found")
    if user.revision != expected_revision:
        raise AccountError("revision_conflict", current=user)
    temporary = await reset_password(
        session, user=user, actor_user_id=principal.user_id, client_ip=client_ip
    )
    return user, temporary
