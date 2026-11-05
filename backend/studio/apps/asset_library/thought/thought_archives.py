"""Keep a Thought archive private until its source transaction is confirmed."""

from sqlalchemy import select, text

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.archive_staging import ArchiveFileStaging, conflict
from studio.apps.asset_library.deletions import schedule
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    AssetReferenceSet,
    ThoughtArchiveBatch,
    ThoughtArchiveFile,
)
from studio.apps.asset_library.thought.thought_uploads import IMAGE_EXTENSIONS
from studio.contracts.asset_library.file_types import ATTACHMENT_EXTENSIONS
from studio.contracts.thought_workshop.thought_archives import ArchiveProjection
from studio.runtime.ids import new_id


class ThoughtArchives(ArchiveFileStaging):
    batch_model = ThoughtArchiveBatch
    file_model = ThoughtArchiveFile
    allowed_extensions = IMAGE_EXTENSIONS | ATTACHMENT_EXTENSIONS

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
