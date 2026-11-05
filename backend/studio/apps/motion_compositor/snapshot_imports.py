"""Validate a portable project and publish it after exact Assets settlement."""

import hashlib
import json
import tempfile
import zipfile
from datetime import datetime
from pathlib import Path, PurePosixPath
from uuid import UUID

from anyio.to_thread import run_sync
from pydantic import BaseModel
from sqlalchemy import text, update

from app.capabilities.media_rendering.motion_document import MotionComposition
from studio.apps.asset_library.clients.archive_delivery import FileBatchDelivery, reserve_import
from studio.apps.motion_compositor.projects import MotionInvalid, MotionUnavailable
from studio.apps.motion_compositor.schemas import ProjectCreateIn, ProjectOut
from studio.apps.motion_compositor.snapshot_format import FORMAT, MAX_ARCHIVE_BYTES
from studio.apps.motion_compositor.storage.models import (
    MotionDocument,
    MotionOperationBatch,
    MotionProject,
)
from studio.apps.motion_compositor.storage.service_models import MotionImportBatch
from studio.contracts.motion_compositor.motion_snapshot import MotionArchiveManifest
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveFileKey
from studio.runtime.files.signed_payloads import ModelOutputDescription
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.time import iso_utc, utc_now


class ImportResult(BaseModel):
    project: ProjectOut
    document: dict


class MotionImportDelivery(FileBatchDelivery):
    runner_name = "motion-archive-delivery"
    records = MotionImportBatch
    result_model = ImportResult
    retry_interrupted = False
    pending_error = staticmethod(lambda: MotionUnavailable("工程包尚未结算"))

    async def complete(self, owner, batch_id, state, result):
        if state == "abort":
            await super().complete(owner, batch_id, state, result)
            return
        value = ImportResult.model_validate(result)
        project = value.project
        stamp = datetime.fromisoformat(project.created_at).replace(tzinfo=None)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await session.get(self.records, (owner, batch_id))
            if batch.state == "published":
                return
            if batch.state != "commit" or batch.result != result:
                raise ValueError("工程包源决议已变化")
            session.add(
                MotionProject(
                    id=project.id,
                    owner_user_id=owner,
                    title=project.title,
                    revision=0,
                    created_at=stamp,
                    updated_at=stamp,
                )
            )
            await session.flush()
            session.add_all(
                [
                    MotionDocument(
                        project_id=project.id, document=value.document, revision=1, updated_at=stamp
                    ),
                    MotionOperationBatch(
                        owner_user_id=owner,
                        project_id=project.id,
                        request_id=f"snapshot-{batch_id}",
                        base_revision=0,
                        result_revision=1,
                        operations=[{"type": "replaceDocument", "document": value.document}],
                        result_document=value.document,
                        created_at=stamp,
                    ),
                ]
            )
            batch.state, batch.updated_at = "published", utc_now()
            await session.commit()


def inspect_archive(archive):
    entries = archive.infolist()
    members = {info.filename: info for info in entries}
    if len(entries) != len(members) or any(
        info.flag_bits & 1 or (info.external_attr >> 16) & 0o170000 == 0o120000 for info in entries
    ):
        raise MotionInvalid("工程包包含无效或重复文件")
    if "manifest.json" not in members or members["manifest.json"].file_size > 5_000_000:
        raise MotionInvalid("工程包缺少有效清单")
    if sum(info.file_size for info in entries) > MAX_ARCHIVE_BYTES * 2:
        raise MotionInvalid("工程包解压后超过大小限制")
    manifest = json.loads(archive.read("manifest.json"))
    if not isinstance(manifest, dict) or manifest.get("format") != FORMAT:
        raise MotionInvalid("不支持此工程包版本")
    sources = manifest.get("assets", [])
    if not isinstance(sources, list) or len(sources) > 500:
        raise MotionInvalid("工程包素材清单无效")
    identities, names = set(), set()
    for source in sources:
        identity, name = source["id"], source["name"]
        parts = PurePosixPath(name).parts
        if (
            not isinstance(identity, str)
            or not identity
            or identity in identities
            or len(parts) != 2
            or parts[0] != "assets"
            or not parts[1].startswith(identity)
            or "\\" in name
            or name in names
        ):
            raise MotionInvalid("工程包素材路径无效或重复")
        identities.add(identity)
        names.add(name)
    if set(members) != {"manifest.json", *names}:
        raise MotionInvalid("工程包包含未登记文件")
    document = MotionComposition.model_validate(manifest["document"])
    if any(layer.asset_id and layer.asset_id not in identities for layer in document.layers):
        raise MotionInvalid("工程包缺少图层素材")
    title = ProjectCreateIn(title=manifest["title"]).title
    return title, document, sources


def extract(archive, entry, target):
    digest, size = hashlib.sha256(), 0
    with archive.open(entry["name"]) as source, target.open("xb") as file:
        while chunk := source.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_ARCHIVE_BYTES * 2:
                raise MotionInvalid("工程包解压后超过大小限制")
            digest.update(chunk)
            file.write(chunk)
    return ModelOutputDescription(
        Path(entry["filename"]).name,
        entry["mimeType"],
        size,
        digest.hexdigest(),
    )


async def chunks(path):
    with path.open("rb") as file:
        while data := await run_sync(file.read, 1024 * 1024):
            yield data


class SnapshotImports:
    def __init__(self, archive, delivery, staging):
        self.archive, self.delivery, self.staging = archive, delivery, staging

    async def read(self, upload, path):
        size, digest = 0, hashlib.sha256()
        with path.open("xb") as file:
            while data := await upload.read(1024 * 1024):
                size += len(data)
                if size > MAX_ARCHIVE_BYTES:
                    raise MotionInvalid("工程包超过大小限制")
                digest.update(data)
                await run_sync(file.write, data)
        return digest.hexdigest()

    async def run(self, session, owner, upload, assertion):
        with tempfile.TemporaryDirectory(dir=self.staging, prefix="motion-import-") as folder:
            root = Path(folder)
            source = root / "source.zip"
            digest = await self.read(upload, source)
            batch_id, prior = await reserve_import(session, MotionImportBatch, owner, digest)
            if prior == "staging":
                raise MotionUnavailable("同一工程包正在导入")
            if prior != "commit":
                await self.commit(session, owner, source, batch_id, digest, assertion)
            try:
                return (await self.delivery.deliver(owner, batch_id)).project
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise MotionUnavailable("工程已保存，正在恢复素材结算") from exc

    async def commit(self, session, owner, source, batch_id, digest, assertion):
        key = ArchiveBatchKey(batch_id=batch_id, source_sha256=digest)
        project_id = UUID(hex=batch_id)
        try:
            with zipfile.ZipFile(source) as archive:
                title, document, sources = await run_sync(inspect_archive, archive)
                files, mapping = [], {}
                for ordinal, entry in enumerate(sources):
                    target = source.with_name(f"file-{ordinal}")
                    try:
                        descriptor = await run_sync(extract, archive, entry, target)
                        asset = await self.archive.stage(
                            owner, key, ordinal, descriptor, chunks(target), assertion
                        )
                    finally:
                        target.unlink(missing_ok=True)
                    mapping[entry["id"]] = asset
                    files.append(
                        ArchiveFileKey(ordinal=ordinal, descriptor_sha256=descriptor.fingerprint)
                    )
            for layer in document.layers:
                if layer.asset_id:
                    asset = mapping[layer.asset_id]
                    if asset.media_kind != layer.kind:
                        raise MotionInvalid("素材类型与图层类型不一致")
                    layer.asset_id = asset.id
            manifest = MotionArchiveManifest(project_id=project_id, files=files)
            await self.archive.seal(owner, key, manifest, assertion)
            stamp = iso_utc(utc_now())
            result = ImportResult(
                project=ProjectOut(
                    id=str(project_id), title=title, revision=0, createdAt=stamp, updatedAt=stamp
                ),
                document=document.model_dump(mode="json", by_alias=True),
            )
            changed = await session.execute(
                update(MotionImportBatch)
                .where(MotionImportBatch.batch_id == batch_id, MotionImportBatch.state == "staging")
                .values(
                    state="commit",
                    manifest_sha256=manifest.fingerprint,
                    result=result.model_dump(mode="json", by_alias=True),
                    updated_at=utc_now(),
                )
            )
            if changed.rowcount != 1:
                raise MotionUnavailable("工程包源状态已变化")
        except BaseException as exc:
            await session.rollback()
            await self.delivery.release(owner, batch_id, retry=False)
            if isinstance(exc, CapabilityDenied):
                if exc.status in {404, 413, 422}:
                    raise MotionInvalid("工程包素材不受支持或损坏") from exc
                raise MotionUnavailable("工程包素材授权失败") from exc
            if isinstance(exc, CapabilityUnavailable):
                raise MotionUnavailable("工程包素材未确认") from exc
            if isinstance(exc, (KeyError, ValueError, TypeError, zipfile.BadZipFile)):
                raise MotionInvalid("工程包结构无效") from exc
            raise
        await session.commit()
