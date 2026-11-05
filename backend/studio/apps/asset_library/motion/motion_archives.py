"""Publish an imported Motion project's media only after its source decision."""

from uuid import UUID

from anyio.to_thread import run_sync
from sqlalchemy import select, text

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.archive_staging import ArchiveFileStaging, conflict
from studio.apps.asset_library.deletions import schedule
from studio.apps.asset_library.storage.service_models import (
    AssetReferenceSet,
    MotionArchiveBatch,
    MotionArchiveFile,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.motion_compositor.motion_snapshot import (
    MAX_ARCHIVE_BYTES,
    MotionArchiveManifest,
)
from studio.runtime.files.digests import sha256_file


class ScopedProjectArchives(ArchiveFileStaging):
    resource_kind = "project"

    def placement(self, key):
        return {self.project_column: str(UUID(hex=key.batch_id))}

    async def seal(self, *, owner, key, manifest):
        if manifest.project_id.hex != key.batch_id:
            raise conflict("archive_project_mismatch")
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await self._batch(session, owner, key)
            if batch is None:
                batch = self._new_batch(session, owner, key)
            if batch.state == "aborted":
                raise conflict("archive_aborted")
            if batch.manifest_sha256 is not None:
                if batch.manifest_sha256 != manifest.fingerprint:
                    raise conflict("archive_manifest_conflict")
                return batch.state
            files = await self._files(session, key.batch_id)
            if [(row.ordinal, row.descriptor_sha256) for row in files] != [
                (file.ordinal, file.descriptor_sha256) for file in manifest.files
            ]:
                raise conflict("archive_files_incomplete")
            await self.require_new_project(session, manifest.project_id)
            batch.projections = [manifest.model_dump(mode="json")]
            batch.manifest_sha256 = manifest.fingerprint
            batch.state = "sealed"
            await session.commit()
            return batch.state

    @classmethod
    async def require_new_project(cls, session, identity):
        if await session.scalar(
            select(AssetReferenceSet.id).where(
                AssetReferenceSet.service_id == cls.service,
                AssetReferenceSet.resource_kind == cls.resource_kind,
                AssetReferenceSet.resource_id == str(identity),
            )
        ):
            raise conflict("archive_project_overlap")

    async def settle(self, *, owner, key, commit, manifest_sha256=None):
        target = "published" if commit else "aborted"
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await self._batch(session, owner, key)
            if batch is None:
                if commit:
                    raise conflict("archive_unsealed")
                batch = self._new_batch(session, owner, key)
                batch.state = target
                await session.commit()
                return target
            if commit and (manifest_sha256 is None or manifest_sha256 != batch.manifest_sha256):
                raise conflict("archive_manifest_conflict")
            if batch.state == target:
                return target
            if batch.state in {"published", "aborted"} or (commit and batch.state != "sealed"):
                raise conflict("archive_outcome_conflict")
            files = [
                VisualAsset(id=row.asset_id, owner_user_id=owner, **row.metadata_snapshot["asset"])
                for row in await self._files(session, key.batch_id)
            ]
            if commit:
                manifest = self.manifest_type.model_validate(batch.projections[0])
                await self.require_new_project(session, manifest.project_id)
                await self.publish_project(session, owner, manifest, files)
            else:
                schedule(session, files)
            batch.state = target
            await session.commit()
            return target

    async def publish_project(self, session, owner, manifest, files):
        projection = AssetReferenceSet(
            owner_user_id=owner,
            service_id=self.service,
            resource_kind=self.resource_kind,
            resource_id=str(manifest.project_id),
            resource_revision=0,
        )
        session.add(projection)
        session.add_all(files)
        return projection


class PortableProjectArchives(ScopedProjectArchives):
    @property
    def batch_byte_limit(self):
        return self.settings.fpl_project_snapshot_max_bytes

    def file_limit(self):
        return self.batch_byte_limit

    async def normalize_staged(self, description, row, path):
        if (
            row.byte_size != description.byte_size
            or await run_sync(sha256_file, path) != description.content_sha256
        ):
            raise AssetError("归档文件内容已变化", code="archive_file_changed", status=422)
        row.display_name = description.display_name

    def asset_result(self, row):
        return {**super().asset_result(row), "display_name": row.display_name}


class MotionArchives(ScopedProjectArchives):
    service = "motion"
    project_column = "motion_compositor_project_id"
    manifest_type = MotionArchiveManifest
    batch_model = MotionArchiveBatch
    file_model = MotionArchiveFile
    allowed_extensions = None
    batch_byte_limit = 2 * MAX_ARCHIVE_BYTES
