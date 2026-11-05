"""Explicitly enabled host access, with password reauthentication and per-account TOTP."""

import os
import time

from fastapi import HTTPException
from sqlalchemy import select

from studio.apps.identity.storage.models.accounts import AuthSession, User
from studio.apps.identity.storage.models.cloud import CloudFactor, CloudUnlock
from studio.config.settings import get_cloud_settings
from studio.contracts.identity.cloud_authority import TICKET_SECONDS as TICKET_SECONDS
from studio.runtime.time import utc_now


def allowed(principal, *, local, desktop=False, settings=None):
    return _allowed(
        settings if settings is not None else get_cloud_settings(),
        principal,
        local=local,
        desktop=desktop,
    )


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


def require_enabled(principal, *, local, desktop=False, settings=None):
    if not allowed(principal, local=local, desktop=desktop, settings=settings):
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


async def enrolled(db, owner):
    return bool(
        await db.scalar(select(CloudFactor.secret).where(CloudFactor.owner_user_id == owner))
    )
