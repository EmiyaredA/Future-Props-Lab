"""Account archive import with confirmed staged metadata and a durable Assets decision."""

import asyncio
import hashlib
import json
import re
from pathlib import Path
from tempfile import TemporaryDirectory
from uuid import UUID

from anyio.to_thread import run_sync
from sqlalchemy import select, text

from app.apps.thought_workshop.archive_files import extract_archive
from app.apps.thought_workshop.archive_import import (
    allocate_ids,
    archive_references,
    persist_archive,
)
from app.apps.thought_workshop.asset_metadata import LibraryAsset
from app.apps.thought_workshop.errors import ThoughtError
from app.apps.thought_workshop.knowledge_tools.models import ThoughtTemplate
from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote
from app.apps.thought_workshop.notes import Notes
from app.capabilities.asset_store.policy import normalize_content_type
from fpl_runtime.capability_client import CapabilityUnavailable
from fpl_runtime.thought_archives import (
    IMPORT_PATH,
    MAX_MANIFEST_BYTES,
    ArchiveBatchKey,
    ArchiveFileKey,
    ArchiveManifest,
    ArchiveProjection,
)
from fpl_runtime.thought_uploads import ThoughtUploadDescription

from .archive_delivery import begin_import
from .archive_records import ThoughtArchiveImport

RESOURCE_MODELS = {
    "knowledge-base": ThoughtKnowledgeBase,
    "note": ThoughtNote,
    "template": ThoughtTemplate,
}


class StagedMetadata:
    def __init__(self, files):
        self.files = files

    async def describe(self, asset_ids):
        if not asset_ids <= self.files.keys():
            raise ThoughtError("备份缺少引用文件")
        return {asset_id: self.files[asset_id] for asset_id in asset_ids}


def sha256(path):
    with path.open("rb") as source:
        return hashlib.file_digest(source, "sha256").hexdigest()


def archive_descriptions(payload):
    for asset in payload["assets"]:
        path = Path(asset["staged_path"])
        try:
            filename = Path(asset["filename"]).name
            mime = normalize_content_type(asset["content_type"])
            if not re.fullmatch(r"[a-z0-9.+-]+/[a-z0-9.+-]+", mime):
                mime = "application/octet-stream"
            yield (
                asset["id"],
                path,
                ThoughtUploadDescription(
                    "attachment", filename, mime, path.stat().st_size, sha256(path)
                ),
            )
        except (ValueError, KeyError, TypeError) as exc:
            raise ThoughtError("备份附件信息无效") from exc


def initial_projections(payload, parsed, ids, mapping, *, existing):
    refs = archive_references(payload, parsed, ids, mapping, into_existing=existing)
    revisions = {}
    for entry in payload.get("history", []):
        resource_id = ids.notes[entry["note_id"]]
        revisions[resource_id] = max(revisions.get(resource_id, 0), int(entry["revision"]) + 1)
    for note_id, table in payload.get("multitables", {}).items():
        revisions[ids.notes[note_id]] = table["revision"]
    return [
        ArchiveProjection(
            resource_kind=kind,
            resource_id=resource,
            resource_revision=revisions.get(resource, 0),
            asset_ids=sorted(assets),
        )
        for (kind, resource), assets in sorted(refs.items())
    ]


async def verify_revisions(session, projections):
    for kind, model in RESOURCE_MODELS.items():
        expected = {
            projection.resource_id: projection.resource_revision
            for projection in projections
            if projection.resource_kind == kind
        }
        if not expected:
            continue
        rows = await session.execute(select(model.id, model.revision).where(model.id.in_(expected)))
        if dict(rows.all()) != expected:
            raise ThoughtError("导入资源修订与封存清单不一致", 409, "archive_projection_mismatch")


async def prepare_assets(transport, owner, key, assertion, payload):
    descriptions = await run_sync(lambda: list(archive_descriptions(payload)))
    files, mapping, metadata = [], {}, {}
    for ordinal, (source_id, path, description) in enumerate(descriptions):
        asset = await transport.stage(owner, key, ordinal, description, path, assertion)
        if asset.id in metadata:
            raise CapabilityUnavailable("归档文件回执标识重复")
        files.append(ArchiveFileKey(ordinal=ordinal, descriptor_sha256=description.fingerprint))
        mapping[source_id] = asset.id
        metadata[asset.id] = LibraryAsset(**asset.model_dump())
    return files, mapping, metadata


async def persist_import(
    session,
    owner,
    key,
    payload,
    parsed,
    ids,
    mapping,
    metadata,
    manifest,
    knowledge_base_id,
    expected_revision,
):
    await session.execute(text("BEGIN IMMEDIATE"))
    receipt = await session.get(ThoughtArchiveImport, (owner, key.batch_id))
    if receipt is None or receipt.state != "staging":
        raise ThoughtError("归档批次状态不匹配", 409, "archive_outcome_conflict")
    # The port carries only validated metadata from this batch. No HTTP occurs during writes.
    factory = session.info["thought_asset_metadata_factory"]
    session.info["thought_asset_metadata_factory"] = lambda _session, _owner: StagedMetadata(
        metadata
    )
    try:
        result, _, _ = await persist_archive(
            Notes(session, owner, owner),
            payload,
            parsed,
            mapping,
            ids,
            knowledge_base_id,
            expected_revision,
        )
        await session.flush()
        await verify_revisions(session, manifest.projections)
        receipt.state = "commit"
        receipt.manifest_sha256 = manifest.fingerprint
        receipt.result = result.model_dump(mode="json")
        await session.flush()
    finally:
        session.info["thought_asset_metadata_factory"] = factory


async def fingerprint_upload(upload, maximum_bytes, knowledge_base_id, expected_revision):
    digest = hashlib.sha256()
    size = 0
    while chunk := await upload.read(1024 * 1024):
        size += len(chunk)
        if size > maximum_bytes:
            raise ThoughtError("备份超过大小限制", 413)
        digest.update(chunk)
    await upload.seek(0)
    return hashlib.sha256(
        json.dumps(
            [digest.hexdigest(), knowledge_base_id, expected_revision], separators=(",", ":")
        ).encode()
    ).hexdigest()


async def import_archive(
    session,
    *,
    owner,
    upload,
    request_key,
    knowledge_base_id,
    expected_revision,
    assertion,
    identity,
    limits,
    file_limit,
    delivery,
):
    try:
        if request_key is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", request_key):
            raise ThoughtError("归档请求标识无效")
        if knowledge_base_id and expected_revision is None:
            raise ThoughtError("导入当前知识库需要修订号")
        fingerprint = await fingerprint_upload(
            upload, limits.maximum_bytes, knowledge_base_id, expected_revision
        )
        batch_id, prior = await begin_import(session, owner, fingerprint, request_key)
        if prior in {"commit", "published"}:
            return await delivery.deliver(owner, batch_id)
        if prior:
            raise ThoughtError("归档请求正在处理或已中止", 409, "archive_pending")
        key = ArchiveBatchKey(batch_id=batch_id, source_sha256=fingerprint)
        commit_started = False
        try:
            root = delivery.scratch_path(batch_id)
            root.mkdir(parents=True, exist_ok=True)
            with TemporaryDirectory(prefix="attempt-", dir=root) as directory:
                payload, parsed = await run_sync(
                    lambda: extract_archive(
                        upload.file,
                        Path(directory),
                        maximum_files=limits.maximum_files,
                        maximum_bytes=limits.maximum_bytes,
                        maximum_asset_bytes=file_limit,
                    )
                )
                ids = allocate_ids(payload, namespace=UUID(hex=batch_id))
                transport = delivery.transport
                files, mapping, metadata = await prepare_assets(
                    transport, owner, key, assertion, payload
                )
            manifest = ArchiveManifest(
                files=files,
                projections=initial_projections(
                    payload, parsed, ids, mapping, existing=bool(knowledge_base_id)
                ),
            )
            if len(manifest.model_dump_json().encode()) > MAX_MANIFEST_BYTES:
                raise ThoughtError("归档引用清单过大", 413, "archive_manifest_too_large")
            await transport.seal(owner, key, manifest, assertion)
            active = await identity.status(assertion=assertion, method="POST", path=IMPORT_PATH)
            if active is None:
                raise CapabilityUnavailable("无法确认归档导入权限")
            if not active:
                raise ThoughtError("归档导入权限已撤销", 401, "archive_revoked")
            await persist_import(
                session,
                owner,
                key,
                payload,
                parsed,
                ids,
                mapping,
                metadata,
                manifest,
                knowledge_base_id,
                expected_revision,
            )
            commit_started = True
            await session.commit()
        except BaseException as error:
            await session.rollback()
            if not commit_started:
                await delivery.release(
                    owner,
                    batch_id,
                    retry=isinstance(error, (CapabilityUnavailable, asyncio.CancelledError)),
                )
            raise
        return await delivery.deliver(owner, batch_id)
    finally:
        await upload.close()
