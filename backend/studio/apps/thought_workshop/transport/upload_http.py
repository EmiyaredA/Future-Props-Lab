"""Existing Thought upload operations backed by account-scoped durable intents."""

import hashlib
import re
from dataclasses import dataclass, field
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, File, Header, HTTPException, Request, UploadFile

from app.capabilities.asset_store.policy import normalize_content_type
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.http_bindings import SessionDep
from studio.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut, ThoughtImageOut
from studio.apps.thought_workshop.uploads.upload_intents import (
    confirm_upload,
    deliver_staged_upload,
    stage_upload,
)
from studio.apps.thought_workshop.uploads.upload_transport import fetch_upload_receipt
from studio.assembly.http_dependencies import StudioAuth
from studio.contracts.thought_workshop.thought_uploads import ThoughtUploadDescription
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable

router = APIRouter(prefix="/thought-workshop", tags=["thought-workshop"])


@dataclass(frozen=True)
class UploadConfiguration:
    root: Path
    credential: str = field(repr=False)
    receipt_credential: str = field(repr=False)
    catalog: object = field(repr=False)
    transport: object = field(default=None, repr=False)
    maximum_bytes: int = 200 * 1024 * 1024


async def guarded_upload(operation):
    try:
        return await operation
    except ThoughtError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": str(exc)}) from None
    except CapabilityDenied as exc:
        raise HTTPException(
            exc.status, {"code": "upload_not_accepted", "message": "上传或回执不可用"}
        ) from None
    except CapabilityUnavailable:
        raise HTTPException(
            503, {"code": "upload_unavailable", "message": "上传结果暂不可确认，请重试"}
        ) from None


async def upload_file(request, session, principal, upload, key, kind):
    config = getattr(request.app.state, "thought_upload_configuration", None)
    if not isinstance(config, UploadConfiguration):
        await upload.close()
        raise HTTPException(503, "thought_upload_unavailable")
    request_id = key or uuid4().hex
    try:
        filename = Path(upload.filename or "").name
        mime = normalize_content_type(upload.content_type)
        if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime):
            mime = "application/octet-stream"
        checksum, size = hashlib.sha256(), 0
        while chunk := await upload.read(1024 * 1024):
            size += len(chunk)
            if size > config.maximum_bytes:
                raise ThoughtError("文件超过上传大小限制", 413, "file_too_large")
            checksum.update(chunk)
        try:
            description = ThoughtUploadDescription(kind, filename, mime, size, checksum.hexdigest())
        except ValueError:
            raise ThoughtError("上传文件信息无效", 422, "invalid_upload") from None
        await upload.seek(0)
        row = await stage_upload(
            session,
            root=config.root,
            owner=principal.user_id,
            request_id=request_id,
            description=description,
            incoming=upload,
            maximum_bytes=config.maximum_bytes,
        )
    except BaseException:
        await upload.close()
        raise
    if row.state == "staged":
        saved = await deliver_staged_upload(
            session,
            root=config.root,
            owner=principal.user_id,
            request_id=request_id,
            description=description,
            assertion=request.state.service_assertion,
            source_path=request.url.path,
            credential=config.credential,
            receipt_credential=config.receipt_credential,
            catalog=config.catalog,
            transport=config.transport,
        )
        result = {
            "asset_id": saved.id,
            "filename": saved.original_filename,
            "mime_type": saved.mime_type,
            "byte_size": saved.byte_size,
        }
    elif row.state == "confirmed" and isinstance(row.result, dict):
        previous_id = row.result.get("asset_id")
        if not isinstance(previous_id, str) or not previous_id:
            raise ThoughtError("上传回执无效", 503, "upload_receipt_incomplete")
        await session.rollback()
        saved = await fetch_upload_receipt(
            description=description,
            request_id=request_id,
            owner=principal.user_id,
            assertion=request.state.service_assertion,
            source_path=request.url.path,
            credential=config.credential,
            receipt_credential=config.receipt_credential,
            catalog=config.catalog,
            transport=config.transport,
        )
        await confirm_upload(
            session,
            root=config.root,
            owner=principal.user_id,
            request_id=request_id,
            description=description,
            asset_id=saved.id,
            receipt={
                "filename": saved.original_filename,
                "mime_type": saved.mime_type,
                "byte_size": saved.byte_size,
            },
        )
        result = {
            "asset_id": saved.id,
            "filename": saved.original_filename,
            "mime_type": saved.mime_type,
            "byte_size": saved.byte_size,
        }
    else:
        raise ThoughtError("上传结果尚不可用", 409, "upload_state_conflict")
    if kind == "image":
        return ThoughtImageOut(asset_id=result["asset_id"])
    if set(result) != {"asset_id", "filename", "mime_type", "byte_size"}:
        raise ThoughtError("上传回执缺少文件描述", 503, "upload_receipt_incomplete")
    return ThoughtAttachmentOut.model_validate(result)


@router.post(
    "/images",
    response_model=ThoughtImageOut,
    operation_id="upload_image_v1_thought_workshop_images_post",
    summary="Upload Image",
)
async def upload_image(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    upload: UploadFile = File(),
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="独立 Thought 服务用于上传重试；恢复网站暂不去重。",
    ),
):
    return await guarded_upload(
        upload_file(request, session, principal, upload, idempotency_key, "image")
    )


@router.post(
    "/attachments",
    response_model=ThoughtAttachmentOut,
    operation_id="attachments_v1_thought_workshop_attachments_post",
    summary="Attachments",
)
async def upload_attachment(
    request: Request,
    session: SessionDep,
    principal: StudioAuth,
    upload: UploadFile = File(),
    idempotency_key: str | None = Header(
        default=None,
        alias="Idempotency-Key",
        min_length=1,
        max_length=128,
        pattern=r"^[A-Za-z0-9_-]+$",
        description="独立 Thought 服务用于上传重试；恢复网站暂不去重。",
    ),
):
    return await guarded_upload(
        upload_file(request, session, principal, upload, idempotency_key, "attachment")
    )
