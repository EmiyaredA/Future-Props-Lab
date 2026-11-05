"""Publish an imported Video project only after exact Assets archive settlement."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel
from sqlalchemy import text, update

from app.capabilities.asset_store.project_snapshots import (
    ProjectSnapshotError,
    stage_project_snapshot,
)
from studio.apps.asset_library.clients.archive_delivery import FileBatchDelivery, reserve_import
from studio.apps.asset_library.clients.archive_transfer import (
    HashingUpload,
    SnapshotFileDescription,
    chunks,
)
from studio.apps.video_editor.projects import project_out
from studio.apps.video_editor.schemas import (
    VideoEditorProjectOut,
    VideoEditorProjectSnapshotImportOut,
)
from studio.apps.video_editor.snapshot_format import remap_timeline, validated_snapshot
from studio.apps.video_editor.storage.galgame_handoff_records import reserve_handoff
from studio.apps.video_editor.storage.models import VideoEditorProject, VideoEditorTimeline
from studio.apps.video_editor.storage.service_models import VideoImportBatch
from studio.contracts.thought_workshop.thought_archives import ArchiveBatchKey, ArchiveFileKey
from studio.contracts.video_editor.video_snapshot import VideoArchiveManifest
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.time import utc_now

from .media_registration import register_media


class SnapshotImportResult(BaseModel):
    project: VideoEditorProjectOut
    document: dict
    asset_ids: list[str]


class SnapshotDelivery(FileBatchDelivery):
    runner_name = "video-archive-delivery"
    records = VideoImportBatch
    result_model = SnapshotImportResult
    retry_interrupted = False
    pending_error = staticmethod(lambda: ProjectSnapshotError("剪辑工程包尚未完成结算", status=503))

    async def complete(self, owner, batch_id, state, result):
        if state == "abort":
            await super().complete(owner, batch_id, state, result)
            return
        value = SnapshotImportResult.model_validate(result)
        project = value.project
        stamp = datetime.fromisoformat(project.created_at).replace(tzinfo=None)
        async with self.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await session.get(self.records, (owner, batch_id))
            if batch.state == "published":
                return
            if batch.state != "commit" or batch.result != result:
                raise ValueError("剪辑工程包源决议已变化")
            session.add(
                VideoEditorProject(
                    id=project.id,
                    owner_user_id=owner,
                    title=project.title,
                    status=project.status,
                    revision=project.revision,
                    created_at=stamp,
                    updated_at=stamp,
                    source_application=project.source_application,
                    source_project_id=project.source_project_id,
                    source_revision=project.source_revision,
                    source_compiler_version=project.source_compiler_version,
                )
            )
            await session.flush()
            session.add(
                VideoEditorTimeline(
                    project_id=project.id, document=value.document, revision=0, updated_at=stamp
                )
            )
            for identity in value.asset_ids:
                register_media(session, owner, project.id, identity)
            batch.state, batch.updated_at = "published", utc_now()
            await session.commit()


class SnapshotImports:
    def __init__(self, archive, delivery, settings):
        self.archive, self.delivery, self.settings = archive, delivery, settings

    async def run(self, session, owner, upload, assertion, *, handoff=None):
        incoming = HashingUpload(upload)
        staged = await stage_project_snapshot(
            self.settings, incoming, expected_application="video-editor"
        )
        try:
            digest = incoming.digest.hexdigest()
            if handoff is None:
                batch_id, previous = await reserve_import(session, VideoImportBatch, owner, digest)
            else:
                source_project, task_id, expected = handoff
                if expected != digest:
                    raise ProjectSnapshotError("剪辑交接归档摘要不符")
                batch_id, previous, digest = await reserve_handoff(
                    session, owner, source_project, task_id, expected
                )
            if previous == "staging":
                raise ProjectSnapshotError(
                    "同一工程包正在导入", status=503 if handoff is not None else 409
                )
            if previous not in {"commit", "published"}:
                await self.commit(
                    session,
                    owner,
                    staged,
                    batch_id,
                    digest,
                    assertion,
                    handoff_project=handoff[0] if handoff is not None else None,
                )
            try:
                result = await self.delivery.deliver(owner, batch_id)
            except (CapabilityDenied, CapabilityUnavailable) as exc:
                raise ProjectSnapshotError("工程已保存，正在恢复素材结算", status=503) from exc
            return VideoEditorProjectSnapshotImportOut(project=result.project, warnings=[])
        finally:
            staged.cleanup()

    async def commit(
        self, session, owner, staged, batch_id, digest, assertion, *, handoff_project=None
    ):
        key = ArchiveBatchKey(batch_id=batch_id, source_sha256=digest)
        project_id = UUID(hex=batch_id)
        try:
            details, document, assets = validated_snapshot(staged, handoff_project=handoff_project)
            originals = {item.source_id: item for item in staged.manifest.assets}
            files, mapping = [], {}
            for ordinal, item in enumerate(assets):
                identity = item["id"]
                original = originals[identity]
                if item["byte_size"] != original.byte_size:
                    raise ProjectSnapshotError("工程包素材长度与清单不符")
                descriptor = SnapshotFileDescription(
                    item["original_filename"],
                    item["mime_type"],
                    original.byte_size,
                    original.sha256,
                    item["display_name"],
                )
                asset = await self.archive.stage(
                    owner, key, ordinal, descriptor, chunks(staged.asset_path(identity)), assertion
                )
                if (
                    asset.byte_size != original.byte_size
                    or asset.media_kind != item["media_kind"]
                    or asset.display_name != item["display_name"]
                ):
                    raise ProjectSnapshotError("工程包素材回执不符")
                mapping[identity] = asset.id
                files.append(
                    ArchiveFileKey(ordinal=ordinal, descriptor_sha256=descriptor.fingerprint)
                )
            manifest = VideoArchiveManifest(project_id=project_id, files=files)
            await self.archive.seal(owner, key, manifest, assertion)
            stamp = utc_now()
            project = VideoEditorProject(
                id=str(project_id),
                owner_user_id=owner,
                revision=0,
                created_at=stamp,
                updated_at=stamp,
                **details,
            )
            result = SnapshotImportResult(
                project=project_out(project),
                document=remap_timeline(document, mapping),
                asset_ids=list(mapping.values()),
            )
            changed = await session.execute(
                update(VideoImportBatch)
                .where(VideoImportBatch.batch_id == batch_id, VideoImportBatch.state == "staging")
                .values(
                    state="commit",
                    manifest_sha256=manifest.fingerprint,
                    result=result.model_dump(mode="json", by_alias=True),
                    updated_at=stamp,
                )
            )
            if changed.rowcount != 1:
                raise ProjectSnapshotError("剪辑工程包源状态已变化", status=503)
        except BaseException as exc:
            await session.rollback()
            await self.delivery.release(owner, batch_id, retry=False)
            if isinstance(exc, CapabilityDenied):
                raise ProjectSnapshotError(
                    "剪辑工程包素材不受支持或暂不可用", status=exc.status
                ) from exc
            if isinstance(exc, CapabilityUnavailable):
                raise ProjectSnapshotError("剪辑工程包素材回执尚未确认", status=503) from exc
            if isinstance(exc, (KeyError, ValueError, TypeError)):
                raise ProjectSnapshotError("剪辑工程包结构无效") from exc
            raise
        await session.commit()
