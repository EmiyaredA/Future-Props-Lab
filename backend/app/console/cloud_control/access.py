"""Explicitly enabled host access, with password reauthentication and per-account TOTP."""

import base64
import hmac
import os
import secrets
import time

from fastapi import HTTPException
from sqlalchemy import delete, select, text

from app.console.models.accounts import AuthSession, User
from app.runtime.config import get_cloud_settings
from app.runtime.credentials import decrypt_secret, encrypt_secret
from app.runtime.time import utc_now
from fpl_runtime.cloud_authority import TICKET_SECONDS as TICKET_SECONDS

from .models import CloudFactor, CloudUnlock

UNLOCK_SECONDS = 900


def allowed(principal, *, local, desktop=False):
    return _allowed(get_cloud_settings(), principal, local=local, desktop=desktop)


def _allowed(settings, principal, *, local, desktop):
    return (
        settings.fpl_cloud_control_enabled
        and (
            local
            or (
                settings.fpl_cloud_control_public_enabled
                and (desktop or not settings.fpl_cloud_control_public_desktop_vnc_only)
            )
        )
        and principal.auth_kind == "session"
        and principal.allows("cloud-control.access")
        and principal.user_id in settings.fpl_cloud_control_admin_user_ids.split(os.pathsep)
    )


def require_enabled(principal, *, local, desktop=False):
    if not allowed(principal, local=local, desktop=desktop):
        raise HTTPException(403, "该账号或入口未启用云控操作")


def session_query(principal):
    now = utc_now()
    return (
        select(AuthSession.id)
        .join(User, User.id == AuthSession.user_id)
        .where(
            AuthSession.id == principal.session_id,
            AuthSession.user_id == principal.user_id,
            AuthSession.revoked_at.is_(None),
            AuthSession.idle_expires_at > now,
            AuthSession.absolute_expires_at > now,
            User.status == "active",
            User.platform_role == "admin",
            User.must_change_password.is_(False),
        )
    )


async def desktop_authorized(db, principal, *, local):
    settings = get_cloud_settings()
    if not _allowed(settings, principal, local=local, desktop=True):
        return False
    query = session_query(principal)
    if not local:
        query = query.join(CloudUnlock, CloudUnlock.session_id == AuthSession.id).where(
            CloudUnlock.owner_user_id == principal.user_id,
            CloudUnlock.desktop_verified.is_(True),
            AuthSession.reauthenticated_at > AuthSession.created_at,
        )
    return bool(await db.scalar(query))


async def unlock_expiry(db, principal, *, local, settings=None):
    if not _allowed(settings or get_cloud_settings(), principal, local=local, desktop=False):
        return 0
    sessions = session_query(principal)
    if not local:
        sessions = sessions.where(AuthSession.reauthenticated_at > AuthSession.created_at)
    row = await db.scalar(
        select(CloudUnlock.expires_at).where(
            CloudUnlock.session_id.in_(sessions),
            CloudUnlock.owner_user_id == principal.user_id,
        )
    )
    return row if row and row > time.time() else 0


async def require_unlocked(db, principal, *, local, settings=None):
    if not await unlock_expiry(db, principal, local=local, settings=settings):
        raise HTTPException(403, "请先验证密码及动态验证码")


async def begin_factor_update(db, principal):
    await db.rollback()
    await db.execute(text("BEGIN IMMEDIATE"))
    if await db.scalar(session_query(principal)) is None:
        raise HTTPException(401, "账号会话已失效")


async def start_enrollment(db, principal):
    await begin_factor_update(db, principal)
    owner = principal.user_id
    row = await db.get(CloudFactor, owner)
    if row is None:
        row = CloudFactor(
            owner_user_id=owner,
            last_counter=-1,
            attempts=0,
            attempt_window=0,
            pending_until=0,
        )
        db.add(row)
    secret = base64.b32encode(secrets.token_bytes(20)).decode("ascii")
    row.pending_secret = encrypt_secret(secret)
    row.pending_until = int(time.time()) + 300
    await db.commit()
    return secret


def totp(secret, counter):
    digest = hmac.digest(base64.b32decode(secret), counter.to_bytes(8, "big"), "sha1")
    offset = digest[-1] & 15
    value = int.from_bytes(digest[offset : offset + 4], "big") & 0x7FFFFFFF
    return f"{value % 1000000:06}"


async def verify(db, principal, code, *, enroll=False, desktop=False, public=False):
    owner = principal.user_id
    await begin_factor_update(db, principal)
    if (
        public
        and await db.scalar(
            session_query(principal).where(AuthSession.reauthenticated_at > AuthSession.created_at)
        )
        is None
    ):
        raise HTTPException(403, {"code": "reauthentication_required", "message": "请重新验证密码"})
    row = await db.get(CloudFactor, owner)
    now = int(time.time())
    if not row or not (row.pending_secret if enroll else row.secret):
        raise HTTPException(409, "请先在本机登记验证器")
    if enroll and row.pending_until <= now:
        raise HTTPException(409, "登记已过期，请重新开始")
    if row.attempt_window + 300 <= now:
        row.attempt_window, row.attempts = now, 0
    if row.attempts >= 5:
        raise HTTPException(429, "验证码尝试过多，请稍后再试")
    secret = decrypt_secret(row.pending_secret if enroll else row.secret)
    current = now // 30
    match = next(
        (
            step
            for step in (current + 1, current, current - 1)
            if (enroll or step > row.last_counter) and hmac.compare_digest(totp(secret, step), code)
        ),
        None,
    )
    if match is None:
        row.attempts += 1
        await db.commit()
        raise HTTPException(403, "验证码无效或已使用")
    row.last_counter = match
    row.attempts = 0
    if enroll:
        row.secret, row.pending_secret = row.pending_secret, None
        row.pending_until = 0
        await db.execute(delete(CloudUnlock).where(CloudUnlock.owner_user_id == owner))
    session_id = principal.session_id
    unlock = await db.get(CloudUnlock, session_id)
    if unlock is None:
        unlock = CloudUnlock(session_id=session_id, owner_user_id=owner)
        db.add(unlock)
        unlock.expires_at = 0
    if desktop:
        unlock.desktop_verified = True
    else:
        unlock.expires_at = now + UNLOCK_SECONDS
    unlock.ticket_hash, unlock.ticket_until = None, 0
    await db.commit()


async def enrolled(db, owner):
    return bool(
        await db.scalar(select(CloudFactor.secret).where(CloudFactor.owner_user_id == owner))
    )
