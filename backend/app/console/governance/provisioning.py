"""Provision one private account and its model catalog atomically."""

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.capabilities.identity.passwords import (
    generate_temporary_password,
    hash_password,
    normalize_username,
)
from app.console.governance.governance_transactions import begin_governance, require_platform_admin
from app.console.governance.model_templates import initialize_from_template
from app.console.governance.service import AccountError, add_audit_event
from app.console.models import User
from app.llm.catalog.seed import ensure_account_model_catalog
from app.runtime.ownership import bind_owner


async def create_account(
    session,
    *,
    username,
    display_name,
    is_platform_admin=False,
    actor_user_id=None,
    client_ip="",
    email=None,
    platform_role=None,
    password=None,
    commit=True,
):
    role = platform_role or ("admin" if is_platform_admin else "user")
    if role not in {"admin", "user"}:
        raise AccountError("invalid_platform_role")
    try:
        normalized = normalize_username(username)
        if await session.scalar(select(User.id).where(User.username_normalized == normalized)):
            raise AccountError("username_conflict")
        normalized_email = (email or "").strip()
        if normalized_email and ("@" not in normalized_email or len(normalized_email) > 254):
            raise AccountError("invalid_email")
        temporary = generate_temporary_password()
        user = User(
            username=username.strip(),
            username_normalized=normalized,
            display_name=display_name.strip() or username.strip(),
            password_hash=hash_password(password or temporary),
            email=normalized_email or None,
            email_normalized=normalized_email.casefold() or None,
            is_platform_admin=role == "admin",
            platform_role=role,
            must_change_password=password is None,
        )
        session.add(user)
        await session.flush()
        add_audit_event(
            session,
            "account.created",
            actor_user_id=actor_user_id,
            target_user_id=user.id,
            owner_user_id=user.id,
            client_ip=client_ip,
        )
        await initialize_account_catalog(session, user.id, role)
        if commit:
            await session.commit()
        await session.refresh(user)
        return user, temporary
    except IntegrityError as exc:
        await session.rollback()
        raise AccountError("account_conflict") from exc
    except Exception:
        await session.rollback()
        raise


async def initialize_account_catalog(session, owner_user_id, role="user"):
    previous = session.info.get("owner_user_id")
    bind_owner(session, owner_user_id)
    try:
        if not await initialize_from_template(session, owner_user_id, role):
            await ensure_account_model_catalog(session, owner_user_id)
        await session.flush()
    finally:
        if previous is None:
            session.info.pop("owner_user_id", None)
        else:
            bind_owner(session, previous)


async def create_managed_account(
    session,
    principal,
    *,
    username,
    display_name,
    email,
    is_platform_admin=False,
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
