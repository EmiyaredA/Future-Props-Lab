from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from secrets import compare_digest

from cryptography.fernet import InvalidToken
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from studio.apps.identity.credentials.passwords import (
    generate_temporary_password,
    hash_password,
    validate_password,
    verify_password,
)
from studio.apps.identity.credentials.session_secrets import (
    hash_secret,
    new_management_api_key,
    new_session_secrets,
)
from studio.apps.identity.storage.governance import (
    begin_governance,
    cas,
    revoke_account_credentials,
)
from studio.apps.identity.storage.models.accounts import (
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    User,
)
from studio.contracts.identity.authentication import (
    REAUTH_MINUTES,
    SESSION_ABSOLUTE_DAYS,
    SESSION_IDLE_HOURS,
)
from studio.contracts.identity.errors import AccountError
from studio.contracts.identity.principal import StudioPrincipal
from studio.contracts.identity.usernames import normalize_username
from studio.runtime.time import utc_now


def add_audit_event(
    session: AsyncSession,
    event_type: str,
    *,
    actor_user_id: str | None = None,
    target_user_id: str | None = None,
    owner_user_id: str | None = None,
    client_ip: str = "",
    user_agent: str = "",
    outcome: str = "success",
    metadata: dict | None = None,
) -> None:
    session.add(
        SecurityAuditEvent(
            actor_user_id=actor_user_id,
            target_user_id=target_user_id,
            owner_user_id=owner_user_id,
            event_type=event_type,
            outcome=outcome,
            client_ip=client_ip,
            user_agent=user_agent[:500],
            metadata_json=metadata or {},
        )
    )


async def complete_login(
    session: AsyncSession,
    *,
    username: str,
    password: str,
    client_ip: str,
    user_agent: str,
    purpose: str = "studio",
) -> tuple[User, AuthSession, str, str] | None:
    try:
        normalized = normalize_username(username)
    except ValueError:
        normalized = username.strip().lower()[:64]
    user = await session.scalar(select(User).where(User.username_normalized == normalized))
    valid = False
    upgraded = None
    if user is not None:
        valid, upgraded = verify_password(user.password_hash, password)
    if purpose not in {"studio", "management"}:
        raise ValueError("invalid session purpose")
    if (
        user is None
        or not valid
        or user.status != "active"
        or (purpose == "management" and user.platform_role != "admin")
    ):
        add_audit_event(
            session,
            "auth.login",
            client_ip=client_ip,
            user_agent=user_agent,
            outcome="failure",
            metadata={"username": normalized},
        )
        await session.commit()
        return None
    if upgraded:
        user.password_hash = upgraded
    now = utc_now()
    raw_token, raw_csrf = new_session_secrets()
    auth_session = AuthSession(
        user_id=user.id,
        token_hash=hash_secret(raw_token),
        csrf_hash=hash_secret(raw_csrf),
        created_at=now,
        last_seen_at=now,
        idle_expires_at=now + timedelta(hours=SESSION_IDLE_HOURS),
        absolute_expires_at=now + timedelta(days=SESSION_ABSOLUTE_DAYS),
        reauthenticated_at=now,
        client_ip=client_ip,
        user_agent=user_agent[:500],
    )
    if purpose == "management":
        auth_session.purpose = purpose
    user.last_login_at = now
    session.add(auth_session)
    add_audit_event(
        session,
        "auth.login",
        actor_user_id=user.id,
        owner_user_id=user.id,
        client_ip=client_ip,
        user_agent=user_agent,
    )
    await session.commit()
    return user, auth_session, raw_token, raw_csrf


async def load_current_auth(
    session: AsyncSession, principal: StudioPrincipal
) -> tuple[User, AuthSession | None]:
    user = await session.get(User, principal.user_id)
    auth_session = (
        await session.get(AuthSession, principal.session_id) if principal.session_id else None
    )
    if user is None:
        raise AccountError("studio_auth_required")
    return user, auth_session


async def complete_logout(
    session: AsyncSession, principal: StudioPrincipal, *, client_ip: str
) -> None:
    if principal.session_id is None:
        return
    row = await session.get(AuthSession, principal.session_id)
    if row is not None and row.revoked_at is None:
        row.revoked_at = utc_now()
        add_audit_event(
            session,
            "auth.logout",
            actor_user_id=principal.user_id,
            owner_user_id=principal.owner_user_id,
            client_ip=client_ip,
        )
        await session.commit()


async def list_active_sessions(
    session: AsyncSession, principal: StudioPrincipal
) -> list[AuthSession]:
    now = utc_now()
    return list(
        (
            await session.execute(
                select(AuthSession)
                .where(
                    AuthSession.user_id == principal.user_id,
                    AuthSession.revoked_at.is_(None),
                    AuthSession.idle_expires_at > now,
                    AuthSession.absolute_expires_at > now,
                )
                .order_by(AuthSession.last_seen_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def list_api_keys(
    session: AsyncSession, principal: StudioPrincipal
) -> list[ManagementApiKey]:
    return list(
        (
            await session.execute(
                select(ManagementApiKey)
                .where(
                    ManagementApiKey.user_id == principal.user_id,
                )
                .order_by(ManagementApiKey.created_at.desc())
            )
        )
        .scalars()
        .all()
    )


async def change_password(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    current_password: str,
    new_password: str,
    client_ip: str,
) -> tuple[str, str]:
    if principal.session_id is None:
        raise AccountError("browser_session_required")
    user = await session.get(User, principal.user_id)
    auth_session = await session.get(AuthSession, principal.session_id)
    if user is None or auth_session is None:
        raise AccountError("studio_auth_required")
    if not verify_password(user.password_hash, current_password)[0]:
        raise AccountError("invalid_credentials")
    validate_password(new_password)
    user.password_hash = hash_password(new_password)
    user.must_change_password = False
    user.revision += 1
    now = utc_now()
    await session.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == user.id,
            AuthSession.id != auth_session.id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    raw_token, raw_csrf = new_session_secrets()
    auth_session.token_hash = hash_secret(raw_token)
    auth_session.csrf_hash = hash_secret(raw_csrf)
    auth_session.last_seen_at = now
    auth_session.idle_expires_at = min(
        now + timedelta(hours=SESSION_IDLE_HOURS), auth_session.absolute_expires_at
    )
    auth_session.reauthenticated_at = now
    add_audit_event(
        session,
        "account.password_changed",
        actor_user_id=user.id,
        target_user_id=user.id,
        client_ip=client_ip,
    )
    await session.commit()
    return raw_token, raw_csrf


async def reauthenticate(
    session: AsyncSession, principal: StudioPrincipal, *, password: str, client_ip: str
) -> bool:
    if principal.session_id is None:
        return False
    user = await session.get(User, principal.user_id)
    auth_session = await session.get(AuthSession, principal.session_id)
    if user is None or auth_session is None or not verify_password(user.password_hash, password)[0]:
        add_audit_event(
            session,
            "auth.reauthenticated",
            actor_user_id=principal.user_id,
            client_ip=client_ip,
            outcome="failure",
        )
        await session.commit()
        return False
    auth_session.reauthenticated_at = utc_now()
    add_audit_event(
        session,
        "auth.reauthenticated",
        actor_user_id=user.id,
        client_ip=client_ip,
    )
    await session.commit()
    return True


async def revoke_session(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    session_id: str,
    client_ip: str,
) -> bool:
    row = await session.scalar(
        select(AuthSession).where(
            AuthSession.id == session_id,
            AuthSession.user_id == principal.user_id,
            AuthSession.revoked_at.is_(None),
        )
    )
    if row is None:
        return False
    row.revoked_at = utc_now()
    add_audit_event(
        session,
        "auth.session_revoked",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"session_id": row.id, "current": row.id == principal.session_id},
    )
    await session.commit()
    return True


async def revoke_other_sessions(
    session: AsyncSession, principal: StudioPrincipal, *, client_ip: str
) -> int:
    now = utc_now()
    result = await session.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == principal.user_id,
            AuthSession.id != principal.session_id,
            AuthSession.revoked_at.is_(None),
        )
        .values(revoked_at=now)
    )
    add_audit_event(
        session,
        "auth.other_sessions_revoked",
        actor_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"count": result.rowcount},
    )
    await session.commit()
    return int(result.rowcount or 0)


async def create_api_key(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    name: str,
    scopes: list[str],
    expires_in_days: int,
    client_ip: str,
    encrypt: Callable[[str], str],
) -> tuple[ManagementApiKey, str]:
    principal = await begin_governance(session, principal)
    allowed = {"studio:read", "studio:write"}
    normalized = set(scopes)
    if not normalized or not normalized <= allowed:
        raise AccountError("invalid_api_key_scopes")
    if not normalized <= principal.scopes:
        raise AccountError("invalid_api_key_scopes")
    if "studio:write" in normalized:
        normalized.add("studio:read")
    raw = new_management_api_key()
    key = ManagementApiKey(
        user_id=principal.user_id,
        name=name.strip(),
        key_hash=hash_secret(raw),
        secret_ciphertext=encrypt(raw),
        key_prefix=raw[:12],
        scopes=sorted(normalized),
        expires_at=utc_now() + timedelta(days=expires_in_days),
    )
    session.add(key)
    await session.flush()
    add_audit_event(
        session,
        "management_api_key.created",
        actor_user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        client_ip=client_ip,
        metadata={"key_id": key.id, "scopes": key.scopes},
    )
    await session.commit()
    return key, raw


async def reveal_api_key(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    key_id: str,
    client_ip: str,
    decrypt: Callable[[str], str],
) -> str:
    principal = await begin_governance(session, principal)
    key = await session.scalar(
        select(ManagementApiKey).where(
            ManagementApiKey.id == key_id,
            ManagementApiKey.user_id == principal.user_id,
        )
    )
    if key is None:
        raise AccountError("api_key_not_found")
    now = utc_now()
    if (
        not key.secret_ciphertext
        or key.revoked_at is not None
        or key.expires_at <= now
        or not set(key.scopes) <= principal.scopes
    ):
        raise AccountError("api_key_secret_unavailable")
    if principal.reauthenticated_at is None or now - principal.reauthenticated_at > timedelta(
        minutes=REAUTH_MINUTES
    ):
        raise AccountError("reauthentication_required")
    try:
        raw = decrypt(key.secret_ciphertext)
    except (InvalidToken, UnicodeError):
        raise AccountError("api_key_secret_unavailable") from None
    if not compare_digest(hash_secret(raw), key.key_hash):
        raise AccountError("api_key_secret_unavailable")
    add_audit_event(
        session,
        "management_api_key.secret_revealed",
        actor_user_id=principal.user_id,
        owner_user_id=principal.user_id,
        client_ip=client_ip,
        metadata={"key_id": key.id},
    )
    await session.commit()
    return raw


async def revoke_api_key(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    key_id: str,
    expected_revision: int,
    client_ip: str,
) -> ManagementApiKey:
    principal = await begin_governance(session, principal)
    key = await session.scalar(
        select(ManagementApiKey).where(
            ManagementApiKey.id == key_id,
            ManagementApiKey.user_id == principal.user_id,
        )
    )
    if key is None:
        raise AccountError("api_key_not_found")
    if key.revision != expected_revision:
        raise AccountError("revision_conflict", current=key)
    key = await cas(
        session,
        ManagementApiKey,
        key.id,
        expected_revision,
        revoked_at=utc_now(),
        secret_ciphertext=None,
    )
    add_audit_event(
        session,
        "management_api_key.revoked",
        actor_user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        client_ip=client_ip,
        metadata={"key_id": key.id},
    )
    await session.commit()
    return key


async def renew_api_key(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    key_id: str,
    expected_revision: int,
    expires_in_days: int,
    client_ip: str,
) -> ManagementApiKey:
    principal = await begin_governance(session, principal)
    key = await session.scalar(
        select(ManagementApiKey).where(
            ManagementApiKey.id == key_id,
            ManagementApiKey.user_id == principal.user_id,
        )
    )
    if key is None:
        raise AccountError("api_key_not_found")
    if key.revision != expected_revision:
        raise AccountError("revision_conflict", current=key)
    if key.revoked_at is not None:
        raise AccountError("api_key_revoked")
    if not set(key.scopes) <= principal.scopes:
        raise AccountError("invalid_api_key_scopes")
    previous_expires_at = key.expires_at
    base = max(previous_expires_at, utc_now())
    key = await cas(
        session,
        ManagementApiKey,
        key.id,
        expected_revision,
        expires_at=base + timedelta(days=expires_in_days),
    )
    add_audit_event(
        session,
        "management_api_key.renewed",
        actor_user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        client_ip=client_ip,
        metadata={
            "key_id": key.id,
            "expires_at_from": previous_expires_at.isoformat(),
            "expires_at_to": key.expires_at.isoformat(),
        },
    )
    await session.commit()
    return key


async def delete_api_key(
    session: AsyncSession,
    principal: StudioPrincipal,
    *,
    key_id: str,
    expected_revision: int,
    client_ip: str,
) -> None:
    principal = await begin_governance(session, principal)
    key = await session.scalar(
        select(ManagementApiKey).where(
            ManagementApiKey.id == key_id,
            ManagementApiKey.user_id == principal.user_id,
        )
    )
    if key is None:
        raise AccountError("api_key_not_found")
    if key.revision != expected_revision:
        raise AccountError("revision_conflict", current=key)
    result = await session.execute(
        delete(ManagementApiKey).where(
            ManagementApiKey.id == key.id,
            ManagementApiKey.user_id == principal.user_id,
            ManagementApiKey.revision == expected_revision,
        )
    )
    if result.rowcount != 1:
        current = await session.get(ManagementApiKey, key.id, populate_existing=True)
        if current is None:
            raise AccountError("api_key_not_found")
        raise AccountError("revision_conflict", current=current)
    add_audit_event(
        session,
        "management_api_key.deleted",
        actor_user_id=principal.user_id,
        owner_user_id=principal.owner_user_id,
        client_ip=client_ip,
        metadata={"key_id": key.id},
    )
    await session.commit()


async def reset_password(
    session: AsyncSession,
    *,
    user: User,
    actor_user_id: str | None,
    client_ip: str = "",
    event_type: str = "account.password_reset",
) -> str:
    temporary_password = generate_temporary_password()
    user = await cas(
        session,
        User,
        user.id,
        user.revision,
        password_hash=hash_password(temporary_password),
        must_change_password=True,
    )
    await revoke_account_credentials(session, user.id)
    add_audit_event(
        session,
        event_type,
        actor_user_id=actor_user_id,
        target_user_id=user.id,
        client_ip=client_ip,
    )
    await session.commit()
    return temporary_password


async def audit_page(
    session: AsyncSession,
    *,
    principal: StudioPrincipal,
    platform: bool,
    page: int,
    page_size: int,
    event_type: str,
    outcome: str,
    actor_query: str = "",
    target_query: str = "",
    from_date: datetime | None = None,
    to_date: datetime | None = None,
) -> tuple[list[tuple[SecurityAuditEvent, str | None, str | None]], int]:
    actor = User.__table__.alias("audit_actor")
    target = User.__table__.alias("audit_target")
    conditions = []
    if not platform:
        conditions.append(
            or_(
                SecurityAuditEvent.actor_user_id == principal.user_id,
                SecurityAuditEvent.target_user_id == principal.user_id,
            )
        )
    if actor_query:
        conditions.append(actor.c.username.ilike(f"%{actor_query.strip()}%"))
    if target_query:
        conditions.append(target.c.username.ilike(f"%{target_query.strip()}%"))
    if from_date:
        conditions.append(
            SecurityAuditEvent.created_at
            >= (from_date.astimezone(UTC).replace(tzinfo=None) if from_date.tzinfo else from_date)
        )
    if to_date:
        conditions.append(
            SecurityAuditEvent.created_at
            <= (to_date.astimezone(UTC).replace(tzinfo=None) if to_date.tzinfo else to_date)
        )
    if event_type:
        conditions.append(SecurityAuditEvent.event_type == event_type)
    if outcome:
        conditions.append(SecurityAuditEvent.outcome == outcome)
    statement = (
        select(
            SecurityAuditEvent,
            actor.c.username,
            target.c.username,
        )
        .outerjoin(actor, actor.c.id == SecurityAuditEvent.actor_user_id)
        .outerjoin(target, target.c.id == SecurityAuditEvent.target_user_id)
        .where(*conditions)
    )
    total = int(await session.scalar(select(func.count()).select_from(statement.subquery())) or 0)
    rows = (
        await session.execute(
            statement.order_by(SecurityAuditEvent.created_at.desc(), SecurityAuditEvent.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
    ).all()
    return list(rows), total


async def account_directory(session, query, limit):
    conditions = [User.status == "active"]
    if query.strip():
        term = "%" + query.strip() + "%"
        conditions.append(or_(User.username.ilike(term), User.display_name.ilike(term)))
    rows = await session.scalars(
        select(User).where(*conditions).order_by(User.username_normalized).limit(limit)
    )
    return {
        "items": [
            {"user_id": u.id, "username": u.username, "display_name": u.display_name} for u in rows
        ]
    }
