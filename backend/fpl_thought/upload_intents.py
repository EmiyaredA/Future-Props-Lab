"""Durable staged upload intents; ambiguous remote outcomes keep their source bytes."""

import hashlib
import re
from dataclasses import asdict
from pathlib import Path

from sqlalchemy import text

from app.apps.thought_workshop.errors import ThoughtError
from app.runtime.time import utc_now
from fpl_runtime.thought_uploads import ThoughtUploadDescription, upload_path

from .upload_records import ThoughtUploadIntent


def stage_path(root: Path, owner: str, request_id: str, fingerprint: str):
    if not isinstance(owner, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,36}", owner):
        raise ValueError("上传账号标识无效")
    upload_path("image", request_id, fingerprint)
    root = root.resolve()
    top = root / "upload-staging"
    if top.is_symlink():
        raise ValueError("上传暂存目录不能是符号链接")
    top.mkdir(mode=0o700, exist_ok=True)
    directory = top / owner
    if directory.is_symlink():
        raise ValueError("上传账号目录不能是符号链接")
    directory.mkdir(mode=0o700, exist_ok=True)
    if not directory.resolve().is_relative_to(root):
        raise ValueError("上传暂存目录越界")
    return directory / (request_id + ".upload")


async def stage_upload(
    session, *, root, owner, request_id, description, incoming, maximum_bytes=200 * 1024 * 1024
):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("上传意图缺少账号上下文")
    if not isinstance(description, ThoughtUploadDescription):
        raise ValueError("上传描述无效")
    if type(maximum_bytes) is not int or maximum_bytes < 1:
        raise ValueError("上传容量限制无效")
    if description.byte_size > maximum_bytes:
        await incoming.close()
        raise ThoughtError("上传超过大小限制", 413, "upload_too_large")
    path = stage_path(root, owner, request_id, description.fingerprint)
    row = await session.get(ThoughtUploadIntent, (owner, request_id))
    if row is not None:
        await incoming.close()
        if row.descriptor_sha256 != description.fingerprint:
            raise ThoughtError("上传请求标识已用于其他文件", 409, "request_id_conflict")
        return row
    await session.rollback()
    created = False
    committing = False
    try:
        if path.is_symlink():
            raise ValueError("上传暂存文件不能是符号链接")
        digest, size = hashlib.sha256(), 0
        try:
            output = path.open("xb")
        except FileExistsError:
            raise ThoughtError("上传暂存结果尚未确认", 409, "upload_staging_pending") from None
        created = True
        with output:
            path.chmod(0o600)
            while chunk := await incoming.read(1024 * 1024):
                size += len(chunk)
                if size > description.byte_size:
                    raise ThoughtError("上传长度不匹配", 422, "upload_changed")
                digest.update(chunk)
                output.write(chunk)
        if size != description.byte_size or digest.hexdigest() != description.content_sha256:
            raise ThoughtError("上传摘要或长度不匹配", 422, "upload_changed")
        await session.execute(text("BEGIN IMMEDIATE"))
        row = ThoughtUploadIntent(
            owner_user_id=owner,
            request_id=request_id,
            descriptor_sha256=description.fingerprint,
            descriptor=asdict(description),
            state="staged",
        )
        session.add(row)
        committing = True
        await session.commit()
        return row
    except BaseException:
        await session.rollback()
        if created and not committing:
            path.unlink(missing_ok=True)
        raise
    finally:
        await incoming.close()


async def confirm_upload(session, *, root, owner, request_id, description, asset_id):
    if session.info.get("owner_user_id") != owner:
        raise ValueError("上传意图缺少账号上下文")
    if not isinstance(asset_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", asset_id):
        raise ValueError("上传回执素材标识无效")
    path = stage_path(root, owner, request_id, description.fingerprint)
    if session.in_transaction():
        raise ValueError("确认上传需要独立事务")
    await session.execute(text("BEGIN IMMEDIATE"))
    row = await session.get(ThoughtUploadIntent, (owner, request_id))
    if row is None or row.descriptor_sha256 != description.fingerprint:
        raise ThoughtError("上传意图不存在", 404, "not_found")
    if row.state == "confirmed":
        if row.result != {"asset_id": asset_id}:
            raise ThoughtError("上传回执不一致", 409, "upload_receipt_conflict")
        await session.rollback()
        return
    if row.state != "staged":
        raise ThoughtError("上传意图状态无效", 409, "upload_state_conflict")
    row.state, row.result, row.updated_at = "confirmed", {"asset_id": asset_id}, utc_now()
    await session.commit()
    # Never remove bytes before the local confirmed receipt is durable.
    if not path.is_symlink():
        path.unlink(missing_ok=True)
