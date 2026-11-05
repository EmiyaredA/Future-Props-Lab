"""Stage a Video group's library originals until the exact Visual canvas decision."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.runtime.time import utc_now
from fpl_runtime.thought_archives import ArchiveBatchKey
from fpl_runtime.video_segment_handoff import SegmentHandoff
from fpl_runtime.video_segments import PublishedSegment, SegmentBatchManifest, segment_receipt_id

from .archive_staging import ArchiveFileStaging, conflict
from .deletions import schedule
from .library_outputs import VerifiedOutput
from .models import (
    AssetReferencePin,
    AssetReferenceSet,
    VideoSegmentHandoffBatch,
    VideoSegmentHandoffFile,
    VisualProjectFileLink,
)
from .references import check_removal_fence
from .scoped_project_files import check_writable
from .video_files import record as file_record
from .video_segment_files import SegmentFile
from .visual_upload_stages import check_canvas_upload_fence


def key_for(task, digest):
    return ArchiveBatchKey(batch_id=segment_receipt_id(task), source_sha256=digest)


class SegmentHandoffFiles(ArchiveFileStaging):
    batch_model = VideoSegmentHandoffBatch
    file_model = VideoSegmentHandoffFile
    allowed_extensions = {".mp4"}

    @property
    def batch_byte_limit(self):
        return self.settings.fpl_project_snapshot_max_bytes

    def file_limit(self):
        return self.settings.fpl_visual_asset_max_bytes

    def asset_result(self, row):
        row.created_at = utc_now()
        return file_record(None, row)

    @staticmethod
    def _scope(project, task, manifest):
        return SegmentHandoff(
            source_project_id=project,
            task_id=task,
            manifest_sha256=manifest.digest,
            target=manifest.target,
        )

    async def _owned_scope(self, session, owner, scope):
        key = key_for(scope.task_id, scope.manifest_sha256)
        row = await self._batch(session, owner, key)
        if row is None or row.scope != scope.model_dump(mode="json"):
            raise AssetError("分段交接批次不存在", code="not_found", status=404)
        return row

    async def _begin(self, owner, key, scope, manifest):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            prior = await self._batch(session, owner, key)
            if prior is not None:
                if prior.scope != scope.model_dump(mode="json") or prior.state == "aborted":
                    raise conflict("segment_handoff_conflict")
                return
            await check_writable(session, "video", scope.source_project_id)
            session.add(
                self.batch_model(
                    owner_user_id=owner,
                    batch_id=key.batch_id,
                    source_sha256=key.source_sha256,
                    scope=scope.model_dump(mode="json"),
                    manifest=manifest.model_dump(mode="json"),
                )
            )
            await session.commit()

    async def _results(self, session, row):
        files = await self._files(session, row.batch_id)
        manifest = SegmentBatchManifest.model_validate(row.manifest)
        if [(file.ordinal, file.descriptor_sha256) for file in files] != [
            (index, description.fingerprint) for index, description in enumerate(manifest.files)
        ]:
            raise conflict("segment_handoff_files_incomplete")
        items = [
            PublishedSegment(
                asset=file.metadata_snapshot["result"], sha256=description.content_sha256
            ).model_dump(mode="json")
            for file, description in zip(files, manifest.files, strict=True)
        ]
        return files, manifest, items

    async def stage(self, owner, project, task, manifest, body, active):
        scope = self._scope(project, task, manifest)
        key = key_for(task, manifest.digest)
        await active()
        await self._begin(owner, key, scope, manifest)
        for ordinal, descriptor in enumerate(manifest.files):
            incoming = SegmentFile(body, descriptor.byte_size)
            await self.stage_file(
                owner=owner,
                key=key,
                ordinal=ordinal,
                description=descriptor,
                incoming=incoming,
                require_active=active,
            )
            # A replay with an existing file receipt still consumes and verifies its bytes.
            if incoming.remaining:
                replay = VerifiedOutput(incoming, descriptor)
                while await replay.read(1024 * 1024):
                    pass
        await body.finished()
        await active()
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._owned_scope(session, owner, scope)
            if row.state == "aborted":
                raise conflict("segment_handoff_conflict")
            _files, _manifest, items = await self._results(session, row)
            if row.state == "staging":
                await check_writable(session, "video", project)
                row.state = "sealed"
                await session.commit()
            return items

    async def prior(self, owner, project, task, digest):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await self._batch(session, owner, key_for(task, digest))
            if row is None or row.state == "staging":
                return None
            if row.scope["source_project_id"] != project or row.state == "aborted":
                raise conflict("segment_handoff_conflict")
            _files, _manifest, items = await self._results(session, row)
            return items

    async def discard_staging(self, owner, project, task, digest):
        key = key_for(task, digest)
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._batch(session, owner, key)
            if row is None:
                return
            if row.scope["source_project_id"] != project or row.state not in {"staging", "aborted"}:
                raise conflict("segment_handoff_conflict")
            if row.state == "aborted":
                return
            files = await self._files(session, row.batch_id)
            schedule(
                session,
                [
                    VisualAsset(
                        id=file.asset_id, owner_user_id=owner, **file.metadata_snapshot["asset"]
                    )
                    for file in files
                ],
            )
            row.state = "aborted"
            await session.commit()

    async def inspect(self, owner, scope):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await self._owned_scope(session, owner, scope)
            if row.state not in {"sealed", "published"}:
                raise conflict("segment_handoff_unsealed")
            _files, manifest, items = await self._results(session, row)
            return {"state": row.state, "labels": manifest.labels, "items": items}

    async def archived(self, session, owner, receipt_id, project):
        row = await session.get(self.batch_model, (owner, receipt_id))
        if row is None or row.state != "published" or row.scope["source_project_id"] != project:
            return None
        _files, _manifest, items = await self._results(session, row)
        return items

    async def _projection(self, session, owner, target):
        projection = await session.scalar(
            select(AssetReferenceSet).where(
                AssetReferenceSet.service_id == "visual",
                AssetReferenceSet.resource_kind == "canvas",
                AssetReferenceSet.resource_id == target.project_id,
            )
        )
        expected = target.expected_revision
        if expected is None:
            if projection is not None:
                raise conflict("segment_target_projection_conflict")
            projection = AssetReferenceSet(
                owner_user_id=owner,
                service_id="visual",
                resource_kind="canvas",
                resource_id=target.project_id,
                resource_revision=0,
            )
            session.add(projection)
            await session.flush()
        elif projection is None or projection.resource_revision < expected:
            raise conflict("segment_target_projection_pending")
        elif projection.deleted or projection.resource_revision != expected:
            raise conflict("segment_target_projection_conflict")
        await check_removal_fence(session, projection.id, "visual")
        await check_canvas_upload_fence(session, projection.id)
        return projection

    async def settle(self, owner, scope, *, publish):
        target = "published" if publish else "aborted"
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await self._owned_scope(session, owner, scope)
            if row.state == target:
                return {"state": target}
            if row.state in {"published", "aborted"} or (publish and row.state != "sealed"):
                raise conflict("segment_handoff_outcome_conflict")
            files = await self._files(session, row.batch_id)
            originals = [
                VisualAsset(
                    id=file.asset_id, owner_user_id=owner, **file.metadata_snapshot["asset"]
                )
                for file in files
            ]
            if publish:
                await self._publish(session, owner, row, scope, originals)
            else:
                schedule(session, originals)
            row.state = target
            await session.commit()
            return {"state": target}

    async def _publish(self, session, owner, row, scope, originals):
        _files, manifest, _items = await self._results(session, row)
        projection = await self._projection(session, owner, scope.target)
        session.add_all(originals)
        await session.flush()
        for file, label in zip(originals, manifest.labels, strict=True):
            session.add(
                VisualProjectFileLink(
                    owner_user_id=owner,
                    project_id=scope.target.project_id,
                    asset_id=file.id,
                    display_name=label,
                )
            )
            session.add(
                AssetReferencePin(
                    reference_set_id=projection.id, asset_id=file.id, owner_user_id=owner
                )
            )
        projection.resource_revision += 1
        projection.revision += 1
