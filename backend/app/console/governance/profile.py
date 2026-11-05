from __future__ import annotations

import asyncio
import hashlib
import os
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from PIL import Image
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.identity.avatar_previews import avatar_thumbnail
from app.console.governance.service import AccountError, add_audit_event
from app.console.models import User
from app.runtime.config import get_settings
from app.runtime.image_sizes import ThumbnailSize
from app.runtime.time import utc_now

AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_CHUNK_BYTES = 128 * 1024
CONTENT_TYPES = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@dataclass(frozen=True)
class StagedAvatar:
    path: Path
    relative_path: str
    content_type: str
    sha256: str


def avatar_url(user: User) -> str | None:
    return "/v1/account/profile/avatar" if user.avatar_relative_path else None


def avatar_path(user: User) -> Path | None:
    if not user.avatar_relative_path:
        return None
    root = get_settings().profiles_path
    path = (root / user.avatar_relative_path).resolve()
    if root not in path.parents:
        return None
    return path


async def update_profile(
    session: AsyncSession,
    *,
    user_id: str,
    display_name: str | None,
    email: str | None,
    expected_revision: int,
    client_ip: str,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise AccountError("studio_auth_required")
    if user.revision != expected_revision:
        raise AccountError("revision_conflict", current=user)
    values: dict[str, object] = {
        "revision": expected_revision + 1,
        "updated_at": utc_now(),
    }
    if display_name is not None:
        normalized_name = display_name.strip()
        if not normalized_name:
            raise AccountError("invalid_profile")
        values["display_name"] = normalized_name
    if email is not None:
        normalized_email = email.strip()
        if normalized_email and ("@" not in normalized_email or len(normalized_email) > 254):
            raise AccountError("invalid_email")
        values["email"] = normalized_email or None
        values["email_normalized"] = normalized_email.casefold() or None
    try:
        result = await session.execute(
            update(User)
            .where(User.id == user_id, User.revision == expected_revision)
            .values(**values)
        )
        if result.rowcount != 1:
            raise AccountError("revision_conflict", current=user)
        add_audit_event(
            session,
            "account.profile_updated",
            actor_user_id=user_id,
            target_user_id=user_id,
            client_ip=client_ip,
        )
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise AccountError("email_conflict") from exc
    return await session.get(User, user_id)


async def avatar_preview(user: User, size: ThumbnailSize) -> Path | None:
    source = avatar_path(user)
    if source is None or not source.is_file():
        return None
    target = (
        get_settings().account_path(user.id)
        / "previews"
        / "avatar"
        / f"{user.avatar_content_sha256}-{size}.webp"
    )
    return await avatar_thumbnail(source, target, size)


def _verify_image(path: Path, content_type: str) -> None:
    try:
        with Image.open(path) as image:
            image.verify()
            detected = Image.open(path).format
    except Exception as exc:
        raise AccountError("invalid_avatar") from exc
    expected = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}[content_type]
    if detected != expected:
        raise AccountError("invalid_avatar")


async def stage_avatar(upload) -> StagedAvatar:
    content_type = (upload.content_type or "").lower()
    suffix = CONTENT_TYPES.get(content_type)
    if suffix is None:
        raise AccountError("invalid_avatar")
    root = get_settings().profiles_path
    staging = root / ".staging"
    staging.mkdir(parents=True, exist_ok=True)
    path = staging / f"{uuid4().hex}{suffix}"
    digest = hashlib.sha256()
    size = 0
    try:
        with path.open("xb") as target:
            while chunk := await upload.read(AVATAR_CHUNK_BYTES):
                size += len(chunk)
                if size > AVATAR_MAX_BYTES:
                    raise AccountError("avatar_too_large")
                digest.update(chunk)
                target.write(chunk)
        if size == 0:
            raise AccountError("invalid_avatar")
        await asyncio.to_thread(_verify_image, path, content_type)
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return StagedAvatar(path, path.relative_to(root).as_posix(), content_type, digest.hexdigest())


async def apply_avatar(
    session: AsyncSession,
    *,
    user_id: str,
    staged: StagedAvatar,
    expected_revision: int,
    client_ip: str,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise AccountError("studio_auth_required")
    if user.revision != expected_revision:
        raise AccountError("revision_conflict", current=user)
    root = get_settings().profiles_path
    suffix = CONTENT_TYPES[staged.content_type]
    relative = Path(user_id) / f"{staged.sha256}{suffix}"
    final = root / relative
    final.parent.mkdir(parents=True, exist_ok=True)
    old = avatar_path(user)
    created_final = not final.exists()
    if created_final:
        os.replace(staged.path, final)
    else:
        staged.path.unlink(missing_ok=True)
    try:
        result = await session.execute(
            update(User)
            .where(User.id == user_id, User.revision == expected_revision)
            .values(
                avatar_relative_path=relative.as_posix(),
                avatar_content_type=staged.content_type,
                avatar_content_sha256=staged.sha256,
                revision=expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            raise AccountError("revision_conflict", current=user)
        add_audit_event(
            session,
            "account.avatar_updated",
            actor_user_id=user_id,
            target_user_id=user_id,
            client_ip=client_ip,
        )
        await session.commit()
    except Exception:
        await session.rollback()
        if created_final:
            final.unlink(missing_ok=True)
        raise
    if old and old != final:
        old.unlink(missing_ok=True)
    return await session.get(User, user_id)


async def delete_avatar(
    session: AsyncSession,
    *,
    user_id: str,
    expected_revision: int,
    client_ip: str,
) -> User:
    user = await session.get(User, user_id)
    if user is None:
        raise AccountError("studio_auth_required")
    if user.revision != expected_revision:
        raise AccountError("revision_conflict", current=user)
    old = avatar_path(user)
    result = await session.execute(
        update(User)
        .where(User.id == user_id, User.revision == expected_revision)
        .values(
            avatar_relative_path="",
            avatar_content_type="",
            avatar_content_sha256="",
            revision=expected_revision + 1,
            updated_at=utc_now(),
        )
    )
    if result.rowcount != 1:
        await session.rollback()
        raise AccountError("revision_conflict", current=user)
    add_audit_event(
        session,
        "account.avatar_deleted",
        actor_user_id=user_id,
        target_user_id=user_id,
        client_ip=client_ip,
    )
    await session.commit()
    if old:
        old.unlink(missing_ok=True)
    return await session.get(User, user_id)


async def reconcile_profile_avatars() -> None:
    root = get_settings().profiles_path
    staging = root / ".staging"
    if staging.is_dir():
        for path in staging.iterdir():
            if path.is_file():
                path.unlink(missing_ok=True)
