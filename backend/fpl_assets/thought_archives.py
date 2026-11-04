"""Keep a Thought archive private until its source transaction is confirmed."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import ATTACHMENT_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.ids import new_id
from fpl_runtime.thought_archives import ArchiveProjection

from .deletions import schedule
from .library_outputs import VerifiedOutput
from .models import (
    AssetReferencePin,
    AssetReferenceSet,
    ThoughtArchiveBatch,
    ThoughtArchiveFile,
)
from .thought_uploads import IMAGE_EXTENSIONS

SNAPSHOT_FIELDS = (
    "original_filename",
    "display_name",
    "storage_key",
    "storage_version",
    "media_kind",
    "mime_type",
    "byte_size",
)


def conflict(code="archive_conflict"):
    return AssetError("归档批次状态或摘要不一致", code=code, status=409)


class ThoughtArchives:
    def __init__(self, database, settings):
        self.database, self.settings = database, settings

    @staticmethod
    async def _batch(session, owner, key):
        batch = await session.get(ThoughtArchiveBatch, (owner, key.batch_id))
        if batch is not None and batch.source_sha256 != key.source_sha256:
            raise conflict()
        return batch

    @staticmethod
    def _new_batch(session, owner, key):
        row = ThoughtArchiveBatch(
            owner_user_id=owner, batch_id=key.batch_id, source_sha256=key.source_sha256
        )
        session.add(row)
        return row

    @staticmethod
    async def _files(session, batch_id):
        return list(
            await session.scalars(
                select(ThoughtArchiveFile)
                .where(ThoughtArchiveFile.batch_id == batch_id)
                .order_by(ThoughtArchiveFile.ordinal)
            )
        )

    @staticmethod
    async def _prior_file(session, owner, batch, ordinal, description):
        if batch is None:
            return None
        if batch.state == "aborted":
            raise conflict("archive_aborted")
        file = await session.get(ThoughtArchiveFile, (owner, batch.batch_id, ordinal))
        if file is None:
            if batch.state != "staging":
                raise conflict()
            return None
        if file.descriptor_sha256 != description.fingerprint:
            raise conflict("archive_file_conflict")
        return file.metadata_snapshot["result"]

    async def stage_file(self, *, owner, key, ordinal, description, incoming, require_active):
        path = None
        committing = False
        try:
            if type(ordinal) is not int or not 0 <= ordinal < 10_000:
                raise AssetError("归档文件序号无效", code="invalid_archive_file", status=422)
            await require_active()
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                batch = await self._batch(session, owner, key)
                prior = await self._prior_file(session, owner, batch, ordinal, description)
                await session.rollback()
                if prior is not None:
                    return prior
                row = await AssetLibrary(session, self.settings).store_upload(
                    VerifiedOutput(
                        incoming,
                        description,
                        changed=AssetError("归档文件摘要或长度不符", code="archive_file_changed"),
                    ),
                    owner_user_id=owner,
                    allowed_extensions=IMAGE_EXTENSIONS | ATTACHMENT_EXTENSIONS,
                    defer_persistence=True,
                )
                path = AssetStorage(self.settings).path_for(row)
                row.id, row.revision = new_id(), 0
                await require_active()
                await session.execute(text("BEGIN IMMEDIATE"))
                batch = await self._batch(session, owner, key)
                prior = await self._prior_file(session, owner, batch, ordinal, description)
                if prior is not None:
                    return prior
                if batch is None:
                    self._new_batch(session, owner, key)
                    await session.flush()
                result = {
                    "id": row.id,
                    "original_filename": row.original_filename,
                    "mime_type": row.mime_type,
                    "media_kind": row.media_kind,
                    "byte_size": row.byte_size,
                    "revision": 0,
                }
                session.add(
                    ThoughtArchiveFile(
                        owner_user_id=owner,
                        batch_id=key.batch_id,
                        ordinal=ordinal,
                        asset_id=row.id,
                        descriptor_sha256=description.fingerprint,
                        metadata_snapshot={
                            "asset": {name: getattr(row, name) for name in SNAPSHOT_FIELDS},
                            "result": result,
                        },
                    )
                )
                # Integrity errors are known before the commit begins.
                await session.flush()
                committing = True
                await session.commit()
                return result
        finally:
            if path is not None and not committing:
                path.unlink(missing_ok=True)
            await incoming.close()

    async def seal(self, *, owner, key, manifest):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await self._batch(session, owner, key)
            if batch is None:
                batch = self._new_batch(session, owner, key)
            if batch.state == "aborted":
                raise conflict("archive_aborted")
            fingerprint = manifest.fingerprint
            if batch.manifest_sha256 is not None:
                if batch.manifest_sha256 != fingerprint:
                    raise conflict("archive_manifest_conflict")
                return batch.state
            staged = await self._files(session, key.batch_id)
            if [(row.ordinal, row.descriptor_sha256) for row in staged] != [
                (entry.ordinal, entry.descriptor_sha256) for entry in manifest.files
            ]:
                raise conflict("archive_files_incomplete")
            staged_ids = {row.asset_id for row in staged}
            if any(not staged_ids.issuperset(item.asset_ids) for item in manifest.projections):
                raise conflict("archive_reference_mismatch")
            await self._check_new_projections(session, manifest.projections)
            batch.state = "sealed"
            batch.manifest_sha256 = fingerprint
            batch.projections = [ref.model_dump(mode="json") for ref in manifest.projections]
            await session.commit()
            return "sealed"

    @staticmethod
    async def _check_new_projections(session, projections):
        for kind in ("knowledge-base", "note", "template"):
            ids = [ref.resource_id for ref in projections if ref.resource_kind == kind]
            if ids and await session.scalar(
                select(AssetReferenceSet.id)
                .where(
                    AssetReferenceSet.service_id == "thought",
                    AssetReferenceSet.resource_kind == kind,
                    AssetReferenceSet.resource_id.in_(ids),
                )
                .limit(1)
            ):
                raise conflict("archive_projection_exists")

    async def settle(self, *, owner, key, commit, manifest_sha256=None):
        """Called after authenticating the durable source outcome for this exact batch."""
        target = "published" if commit else "aborted"
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await self._batch(session, owner, key)
            if batch is None:
                if commit:
                    raise conflict("archive_unsealed")
                batch = self._new_batch(session, owner, key)
                batch.state = "aborted"
                await session.commit()
                return "aborted"
            if commit and (manifest_sha256 is None or batch.manifest_sha256 != manifest_sha256):
                raise conflict("archive_manifest_conflict")
            if batch.state == target:
                return target
            if batch.state in {"published", "aborted"}:
                raise conflict("archive_outcome_conflict")
            files = [
                VisualAsset(
                    id=file.asset_id, owner_user_id=owner, **file.metadata_snapshot["asset"]
                )
                for file in await self._files(session, key.batch_id)
            ]
            if commit:
                if batch.state != "sealed":
                    raise conflict("archive_unsealed")
                await self._publish(session, owner, batch, files)
            else:
                schedule(session, files)
            batch.state = target
            await session.commit()
            return target

    async def _publish(self, session, owner, batch, files):
        projections = [ArchiveProjection.model_validate(value) for value in batch.projections]
        await self._check_new_projections(session, projections)
        entries = [(new_id(), projection) for projection in projections]
        session.add_all(files)
        session.add_all(
            AssetReferenceSet(
                id=entry_id,
                owner_user_id=owner,
                service_id="thought",
                resource_kind=ref.resource_kind,
                resource_id=ref.resource_id,
                resource_revision=ref.resource_revision,
            )
            for entry_id, ref in entries
        )
        await session.flush()
        session.add_all(
            AssetReferencePin(reference_set_id=entry_id, asset_id=asset_id, owner_user_id=owner)
            for entry_id, ref in entries
            for asset_id in ref.asset_ids
        )
