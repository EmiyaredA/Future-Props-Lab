"""Keep the article attachment and its source settlement decision atomic."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select

from app.apps.thought_workshop.account_directory import directory
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.publication.access import article, bind_source, missing, publication
from app.apps.thought_workshop.publication.models import CommunityUpload
from app.apps.thought_workshop.publication.mutations import begin_write
from app.apps.thought_workshop.publication.sessions import source_sessions
from app.apps.thought_workshop.schemas.workshop import ThoughtAttachmentOut
from app.capabilities.asset_store.policy import normalize_content_type
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.community_uploads import CommunityUploadScope, public_path
from fpl_runtime.thought_uploads import ThoughtUploadDescription

from .account_directory import HttpAccountDirectory
from .archive_delivery import FileBatchDelivery
from .community_edits import require_actor
from .community_upload_records import ThoughtCommunityUpload


class CommunityUploadDelivery(FileBatchDelivery):
    runner_name = "thought-community-upload-delivery"
    records = ThoughtCommunityUpload
    pending_error = staticmethod(lambda: ThoughtError("归档批次尚未提交", 409, "archive_pending"))
    result_model = ThoughtAttachmentOut


async def describe(upload, maximum_bytes):
    filename = Path(upload.filename or "").name
    mime = normalize_content_type(upload.content_type)
    if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime):
        mime = "application/octet-stream"
    digest, size = hashlib.sha256(), 0
    while data := await upload.read(1024 * 1024):
        size += len(data)
        if size > maximum_bytes:
            raise ThoughtError("文件超过上传大小限制", 413, "file_too_large")
        digest.update(data)
    await upload.seek(0)
    try:
        return ThoughtUploadDescription("attachment", filename, mime, size, digest.hexdigest())
    except ValueError:
        raise ThoughtError("上传文件信息无效", 422, "invalid_upload") from None


async def article_grant(session, principal, publication_id, note_id):
    pub = await publication(session, publication_id)
    config, _, _ = await article(session, principal, pub, note_id, level="edit")
    return pub, config.revision


def fingerprint(*fields):
    return hashlib.sha256(json.dumps(fields, separators=(",", ":")).encode()).hexdigest()


async def reserve_upload(session, principal, publication_id, note_id, description, request_key):
    await begin_write(session)
    pub, article_revision = await article_grant(session, principal, publication_id, note_id)
    bind_source(session, pub)
    request_sha256 = fingerprint(
        principal.user_id, publication_id, note_id, description.fingerprint
    )
    query = select(ThoughtCommunityUpload)
    if request_key is not None:
        request_key = fingerprint(principal.user_id, publication_id, note_id, request_key)
        query = query.where(ThoughtCommunityUpload.request_key == request_key)
    else:
        query = query.where(
            ThoughtCommunityUpload.request_key.is_(None),
            ThoughtCommunityUpload.request_sha256 == request_sha256,
            ThoughtCommunityUpload.state.in_(("staging", "retry", "commit")),
        )
    existing = await session.scalar(query.limit(1))
    if existing is not None:
        if existing.request_sha256 != request_sha256:
            raise ThoughtError("上传请求标识已用于其他文件", 409, "request_id_conflict")
        scope = CommunityUploadScope.model_validate(existing.scope)
        if existing.state == "retry":
            if (pub.revision, article_revision) != (
                scope.publication_revision,
                scope.article_revision,
            ):
                existing.state = "abort"
                await session.commit()
                raise missing()
            existing.state = "staging"
            await session.commit()
            return scope, None
        state = existing.state
        await session.rollback()
        return scope, state

    scope = CommunityUploadScope(
        actor_id=principal.user_id,
        owner_id=pub.owner_user_id,
        publication_id=publication_id,
        note_id=note_id,
        publication_revision=pub.revision,
        article_revision=article_revision,
        batch_id=uuid4().hex,
        descriptor_sha256=description.fingerprint,
    )
    session.add(
        ThoughtCommunityUpload(
            owner_user_id=scope.owner_id,
            batch_id=scope.batch_id,
            request_key=request_key,
            request_sha256=request_sha256,
            source_sha256=scope.key.source_sha256,
            scope=scope.model_dump(mode="json"),
        )
    )
    await session.commit()
    return scope, None


async def record_upload(session, principal, scope, result, manifest_sha256):
    await begin_write(session)
    pub, article_revision = await article_grant(
        session, principal, scope.publication_id, scope.note_id
    )
    if (pub.owner_user_id, pub.revision, article_revision) != (
        scope.owner_id,
        scope.publication_revision,
        scope.article_revision,
    ):
        raise missing()
    batch = await session.get(ThoughtCommunityUpload, (scope.owner_id, scope.batch_id))
    if batch is None or batch.state != "staging" or batch.source_sha256 != scope.key.source_sha256:
        raise ThoughtError("上传批次状态不匹配", 409, "upload_outcome_conflict")
    session.add(
        CommunityUpload(note_id=scope.note_id, asset_id=result.asset_id, user_id=principal.user_id)
    )
    batch.result = result.model_dump(mode="json")
    batch.manifest_sha256 = manifest_sha256
    batch.state = "commit"
    await session.flush()


async def upload_attachment(
    request_session,
    principal,
    publication_id,
    note_id,
    upload,
    *,
    request_key,
    maximum_bytes,
    delivery,
    identity,
    assertion,
):
    try:
        if principal.auth_kind != "session":
            raise missing()
        if request_key is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_key):
            raise ThoughtError("上传请求标识无效")
        async with source_sessions(request_session)() as session:
            await article_grant(session, principal, publication_id, note_id)
            await session.rollback()
            description = await describe(upload, maximum_bytes)
            account_directory = directory(session)
            if isinstance(account_directory, HttpAccountDirectory):
                await account_directory.refresh()
            scope, prior = await reserve_upload(
                session, principal, publication_id, note_id, description, request_key
            )
            if prior in {"commit", "published"}:
                return await delivery.deliver(scope.owner_id, scope.batch_id)
            if prior is not None:
                raise ThoughtError("上传正在处理或已中止", 409, "upload_pending")

            commit_started = False
            try:
                asset, manifest_sha256 = await delivery.transport.stage_community(
                    scope, description, upload, assertion
                )
                await require_actor(
                    identity, assertion, "POST", public_path(publication_id, note_id)
                )
                if isinstance(account_directory, HttpAccountDirectory):
                    await account_directory.refresh()
                result = ThoughtAttachmentOut(
                    asset_id=asset.id,
                    filename=asset.original_filename,
                    mime_type=asset.mime_type,
                    byte_size=asset.byte_size,
                )
                await record_upload(session, principal, scope, result, manifest_sha256)
                commit_started = True
                await session.commit()
            except BaseException as error:
                await session.rollback()
                if not commit_started:
                    await delivery.release(
                        scope.owner_id,
                        scope.batch_id,
                        retry=isinstance(error, (CapabilityUnavailable, asyncio.CancelledError)),
                    )
                raise
            return await delivery.deliver(scope.owner_id, scope.batch_id)
    finally:
        await upload.close()
