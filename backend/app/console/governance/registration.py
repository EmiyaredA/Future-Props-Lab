"""Registration codes redeem atomically with account and private catalog creation."""

import secrets
from datetime import timedelta

from sqlalchemy import case, func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.errors import AccountError
from app.capabilities.identity.passwords import validate_password
from app.capabilities.identity.security import hash_secret
from app.console.governance.governance_transactions import (
    begin_governance,
    cas,
    require_platform_admin,
)
from app.console.governance.provisioning import create_account
from app.console.governance.service import add_audit_event, complete_login
from app.console.models import User
from app.console.models.platform_governance import RegistrationInviteCode as Invite
from app.console.models.platform_governance import RegistrationRedemption
from app.runtime.credentials import decrypt_secret, encrypt_secret
from app.runtime.time import utc_now


def invite_status(row) -> str:
    if row.deleted_at:
        return "deleted"
    if not row.enabled:
        return "disabled"
    if row.expires_at <= utc_now():
        return "expired"
    return "exhausted" if row.used_count >= row.max_uses else "active"


def invite_view(row) -> dict:
    fields = (
        "id",
        "name",
        "code_hint",
        "enabled",
        "max_uses",
        "used_count",
        "validity_days",
        "expires_at",
        "revision",
        "created_at",
    )
    return {**{field: getattr(row, field) for field in fields}, "status": invite_status(row)}


async def invite_page(session, *, q="", status="", page=1, page_size=25):
    conditions = []
    if q.strip():
        conditions.append(Invite.name.ilike(f"%{q.strip()}%"))
    if status:
        expression = case(
            (Invite.deleted_at.is_not(None), "deleted"),
            (Invite.enabled.is_(False), "disabled"),
            (Invite.expires_at <= utc_now(), "expired"),
            (Invite.used_count >= Invite.max_uses, "exhausted"),
            else_="active",
        )
        conditions.append(expression == status)
    else:
        conditions.append(Invite.deleted_at.is_(None))
    total = await session.scalar(select(func.count()).select_from(Invite).where(*conditions))
    rows = await session.scalars(
        select(Invite)
        .where(*conditions)
        .order_by(Invite.created_at.desc(), Invite.id)
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    return {
        "items": [invite_view(row) for row in rows],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def create_invite(session, principal, body, client_ip):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    if not body.name.strip():
        raise AccountError("invalid_invite_name")
    secret = "fpri_" + secrets.token_urlsafe(24)
    row = Invite(
        name=body.name.strip(),
        max_uses=body.max_uses,
        validity_days=body.validity_days,
        code_hash=hash_secret(secret),
        code_hint=f"{secret[:8]}…{secret[-4:]}",
        secret_ciphertext=encrypt_secret(secret),
        expires_at=utc_now() + timedelta(days=body.validity_days),
    )
    session.add(row)
    await session.flush()
    add_audit_event(
        session,
        "registration_invite.created",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"invite_id": row.id},
    )
    await session.commit()
    return {"invite": invite_view(row), "secret": secret}


async def change_invite(session, principal, invite_id, body, client_ip):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    row = await session.get(Invite, invite_id)
    if row is None or row.deleted_at:
        raise AccountError("registration_invite_not_found")
    if row.revision != body.expected_revision:
        raise AccountError("revision_conflict", current=invite_view(row))
    values = {}
    action = getattr(body, "action", "updated")
    if action == "extend":
        values["expires_at"] = max(row.expires_at, utc_now()) + timedelta(days=body.days)
    elif action == "reset_expiry":
        values["expires_at"] = utc_now() + timedelta(days=row.validity_days)
    elif action == "delete":
        values.update(deleted_at=utc_now(), enabled=False)
    else:
        values = body.model_dump(exclude_none=True, exclude={"expected_revision"})
        if values.get("max_uses", row.max_uses) < row.used_count:
            raise AccountError("invite_quota_below_usage")
    row = await cas(session, Invite, invite_id, body.expected_revision, **values)
    add_audit_event(
        session,
        f"registration_invite.{action}",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"invite_id": row.id},
    )
    await session.commit()
    return invite_view(row)


async def reveal_invite(session, principal, invite_id, client_ip):
    principal = await begin_governance(session, principal)
    require_platform_admin(principal)
    if principal.reauthenticated_at is None or utc_now() - principal.reauthenticated_at > timedelta(
        minutes=10
    ):
        raise AccountError("reauthentication_required")
    row = await session.get(Invite, invite_id)
    if row is None or row.deleted_at:
        raise AccountError("registration_invite_not_found")
    secret = decrypt_secret(row.secret_ciphertext)
    add_audit_event(
        session,
        "registration_invite.secret_revealed",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"invite_id": row.id},
    )
    await session.commit()
    return {"secret": secret}


async def redemption_page(session, invite_id, page, page_size):
    if await session.get(Invite, invite_id) is None:
        raise AccountError("registration_invite_not_found")
    total = await session.scalar(
        select(func.count())
        .select_from(RegistrationRedemption)
        .where(RegistrationRedemption.invite_id == invite_id)
    )
    rows = (
        await session.execute(
            select(RegistrationRedemption, User)
            .join(User)
            .where(RegistrationRedemption.invite_id == invite_id)
            .order_by(RegistrationRedemption.created_at.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return {
        "items": [
            {
                "id": item.id,
                "username": user.username,
                "display_name": user.display_name,
                "created_at": item.created_at,
            }
            for item, user in rows
        ],
        "total": total,
        "page": page,
        "page_size": page_size,
    }


async def register(session: AsyncSession, body, client_ip, user_agent):
    validate_password(body.password)
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    try:
        row = await session.scalar(
            select(Invite).where(Invite.code_hash == hash_secret(body.invite_code.strip()))
        )
        if row is None or invite_status(row) != "active":
            raise AccountError("registration_invite_unavailable")
        user, _ = await create_account(
            session,
            username=body.username,
            display_name=body.display_name,
            email=body.email,
            is_platform_admin=False,
            password=body.password,
            commit=False,
            client_ip=client_ip,
        )
        row.used_count += 1
        row.revision += 1
        row.updated_at = utc_now()
        session.add(RegistrationRedemption(invite_id=row.id, user_id=user.id))
        add_audit_event(
            session,
            "registration_invite.redeemed",
            actor_user_id=user.id,
            owner_user_id=user.id,
            client_ip=client_ip,
            metadata={"invite_id": row.id},
        )
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    return await complete_login(
        session,
        username=body.username,
        password=body.password,
        client_ip=client_ip,
        user_agent=user_agent,
    )
