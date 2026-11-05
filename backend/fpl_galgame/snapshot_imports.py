"""Restore a portable Galgame project after exact Assets archive settlement."""

import re
from datetime import datetime
from uuid import UUID

import httpx
from pydantic import BaseModel, ValidationError
from sqlalchemy import text, update

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameStoryDocument,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.project_values import project_out
from app.apps.galgame_workshop.schemas import GalgameProjectSnapshotImportOut
from app.apps.galgame_workshop.snapshot_values import story_file_ids, validate_snapshot
from app.apps.galgame_workshop.story.reference_index import sync_asset_references
from app.capabilities.asset_store.project_snapshots import (
    ProjectSnapshotError,
    stage_project_snapshot,
)
from app.runtime.time import utc_now
from fpl_runtime.archive_delivery import FileBatchDelivery, reserve_import
from fpl_runtime.archive_transport import HashingUpload, SnapshotFileDescription, chunks
from fpl_runtime.capability_client import CapabilityDenied, CapabilityUnavailable
from fpl_runtime.claims import HEADER
from fpl_runtime.delegation import RequestGrant
from fpl_runtime.galgame_snapshot import (
    IMPORT,
    MODEL_PURPOSE,
    MODEL_RESOLVE_PREFIX,
    GalgameArchiveManifest,
    ModelReference,
)
from fpl_runtime.library_assets import ID
from fpl_runtime.thought_archives import ArchiveBatchKey, ArchiveFileKey

from .models import GalgameSnapshotImportBatch


class SnapshotResult(BaseModel):
    public: GalgameProjectSnapshotImportOut
    document: dict
    assets: list[dict]
    settings: dict


class SnapshotDelivery(FileBatchDelivery):
    runner_name = "galgame-archive-delivery"
    records = GalgameSnapshotImportBatch
    result_model = SnapshotResult
    retry_interrupted = False
    pending_error = staticmethod(lambda: ProjectSnapshotError("Galgame 工程包尚未结算", status=503))

    async def complete(self, owner, batch_id, state, result):
        if state == "abort":
            await super().complete(owner, batch_id, state, result)
            return
        value = SnapshotResult.model_validate(result)
        project = value.public.project
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            batch = await db.get(self.records, (owner, batch_id))
            if batch.state == "published":
                return
            if batch.state != "commit" or batch.result != result:
                raise ValueError("Galgame 工程包源决议已变化")
            db.add(
                GalgameWorkshopProject(
                    id=project.id,
                    owner_user_id=owner,
                    title=project.title,
                    status=project.status,
                    revision=project.revision,
                    created_at=datetime.fromisoformat(project.created_at).replace(tzinfo=None),
                    updated_at=datetime.fromisoformat(project.updated_at).replace(tzinfo=None),
                )
            )
            await db.flush()
            db.add(GalgameStoryDocument(project_id=project.id, document=value.document))
            db.add(GalgameAssetSettings(project_id=project.id, **value.settings))
            db.add_all(GalgameAssetMetadata(project_id=project.id, **item) for item in value.assets)
            await sync_asset_references(db, project.id, story_file_ids(value.document))
            batch.state, batch.updated_at = "published", utc_now()
            await db.commit()


async def resolve_model(capabilities, assertion, value):
    if not value:
        return None
    try:
        reference = ModelReference.model_validate(value)
    except ValidationError:
        return None
    target = f"{MODEL_RESOLVE_PREFIX}/{reference.digest}"
    grant = RequestGrant("galgame", MODEL_PURPOSE, "POST", IMPORT, "models", "POST", target)
    try:
        token = await capabilities.authorize_request(assertion, grant)
        response = await capabilities.client.post(
            "http://models:8080" + target,
            json=reference.model_dump(),
            headers={HEADER: token},
        )
        if response.status_code in {401, 403}:
            raise CapabilityDenied(response.status_code)
        response.raise_for_status()
        resolved = response.json()
        if resolved is not None:
            if not isinstance(resolved, str) or not re.fullmatch(ID, resolved):
                raise ValueError("invalid resolved model identity")
        return resolved
    except CapabilityDenied as exc:
        raise ProjectSnapshotError("Galgame 模型设置授权已结束", status=exc.status) from exc
    except (CapabilityUnavailable, httpx.HTTPError, ValueError) as exc:
        raise ProjectSnapshotError("Galgame 模型目录暂不可用", status=503) from exc


class SnapshotImports:
    def __init__(self, state, archive, delivery):
        self.state, self.archive, self.delivery = state, archive, delivery

    async def run(self, session, owner, upload, assertion):
        root = self.state.snapshot_settings.runtime_path
        staging = root / ".tmp" / "project-snapshots"
        if staging.is_symlink() or not staging.resolve().is_relative_to(root):
            await upload.close()
            raise ProjectSnapshotError("项目快照暂存目录不可用", status=503)
        incoming = HashingUpload(upload)
        staged = await stage_project_snapshot(
            self.state.snapshot_settings, incoming, expected_application="galgame-workshop"
        )
        try:
            values = validate_snapshot(staged)
            digest = incoming.digest.hexdigest()
            batch_id, previous = await reserve_import(
                session, GalgameSnapshotImportBatch, owner, digest
            )
            if previous == "staging":
                raise ProjectSnapshotError("同一 Galgame 工程包正在导入", status=503)
            if previous != "commit":
                key = ArchiveBatchKey(batch_id=batch_id, source_sha256=digest)
                await self.prepare(session, owner, key, values, staged, assertion)
            try:
                return (await self.delivery.deliver(owner, batch_id)).public
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise ProjectSnapshotError("项目已保存，正在恢复素材结算", status=503) from exc
        finally:
            staged.cleanup()

    async def prepare(self, session, owner, key, values, staged, assertion):
        project_id = UUID(hex=key.batch_id)
        try:
            model_id = await resolve_model(
                self.state.capabilities, assertion, values.model_reference
            )
            metadata, identities, members, used = await self.stage(
                owner, key, values, staged, assertion
            )
            document = values.with_files(identities)
            manifest = GalgameArchiveManifest(
                project_id=project_id, files=members, story_ordinals=used
            )
            await self.archive.seal(owner, key, manifest, assertion)
            now = utc_now()
            project = GalgameWorkshopProject(
                id=str(project_id),
                owner_user_id=owner,
                title=values.title,
                is_official=False,
                status=values.status,
                revision=0,
                created_at=now,
                updated_at=now,
            )
            result = SnapshotResult(
                public=GalgameProjectSnapshotImportOut(
                    project=project_out(project), warnings=values.model_warnings(model_id)
                ),
                document=document,
                assets=metadata,
                settings={
                    "asr_model_id": model_id,
                    "default_language": values.language,
                    "concurrency": values.concurrency,
                },
            )
            await session.execute(text("BEGIN IMMEDIATE"))
            written = await session.execute(
                update(GalgameSnapshotImportBatch)
                .where(
                    GalgameSnapshotImportBatch.owner_user_id == owner,
                    GalgameSnapshotImportBatch.batch_id == key.batch_id,
                    GalgameSnapshotImportBatch.state == "staging",
                )
                .values(
                    manifest_sha256=manifest.fingerprint,
                    result=result.model_dump(mode="json"),
                    state="commit",
                    updated_at=now,
                )
            )
            if written.rowcount != 1:
                raise ProjectSnapshotError("Galgame 工程包状态已变化", status=409)
            await session.commit()
        except BaseException as exc:
            await session.rollback()
            await self.delivery.release(owner, key.batch_id, retry=False)
            if isinstance(exc, CapabilityDenied):
                raise ProjectSnapshotError(
                    "Galgame 工程包素材未获准保存", status=exc.status
                ) from exc
            if isinstance(exc, CapabilityUnavailable):
                raise ProjectSnapshotError("Galgame 工程包素材暂不可保存", status=503) from exc
            raise

    async def stage(self, owner, key, values, staged, assertion):
        manifest = {item.source_id: item for item in staged.manifest.assets}
        required = story_file_ids(values.document)
        metadata, identities, files, used = [], {}, [], []
        for ordinal, item in enumerate(values.assets):
            source_id = item["id"]
            source = manifest[source_id]
            if item["byte_size"] != source.byte_size:
                raise ProjectSnapshotError("快照素材记录与清单长度不一致")
            try:
                descriptor = SnapshotFileDescription(
                    item["original_filename"],
                    item["mime_type"],
                    item["byte_size"],
                    source.sha256,
                    item["display_name"],
                )
            except ValueError as exc:
                raise ProjectSnapshotError("Galgame 快照素材描述无效") from exc
            asset = await self.archive.stage(
                owner, key, ordinal, descriptor, chunks(staged.asset_path(source_id)), assertion
            )
            if (
                asset.original_filename != descriptor.filename
                or asset.display_name != descriptor.display_name
                or asset.media_kind != item["media_kind"]
                or asset.byte_size != descriptor.byte_size
            ):
                raise ProjectSnapshotError("Galgame 快照素材类型或名称已变化")
            identities[source_id] = asset.id
            files.append(ArchiveFileKey(ordinal=ordinal, descriptor_sha256=descriptor.fingerprint))
            if source_id in required:
                used.append(ordinal)
            metadata.append(
                {
                    "asset_id": asset.id,
                    **{
                        name: item.get(name)
                        for name in (
                            "category",
                            "virtual_path",
                            "packaging_policy",
                            "checksum_sha256",
                            "width",
                            "height",
                            "duration_ms",
                            "transcript",
                            "transcript_language",
                            "transcript_status",
                            "transcript_source",
                            "transcript_revision",
                            "transcript_segments",
                        )
                    },
                }
            )
        return metadata, identities, files, used
