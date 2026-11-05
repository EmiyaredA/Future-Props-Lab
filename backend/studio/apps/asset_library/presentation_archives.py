"""Stage Presentation media and publish its account-scoped reference set."""

from sqlalchemy import select, text

from app.capabilities.asset_store.models import VisualAsset
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    AssetReferenceSet,
    PresentationArchiveBatch,
    PresentationArchiveFile,
)
from studio.contracts.presentation_workshop.presentation_archives import (
    MAX_BYTES,
    PresentationManifest,
)
from studio.runtime.ids import new_id

from .archive_staging import ArchiveFileStaging, conflict
from .deletions import schedule


class PresentationArchives(ArchiveFileStaging):
    batch_model = PresentationArchiveBatch
    file_model = PresentationArchiveFile
    allowed_extensions = None
    batch_byte_limit = MAX_BYTES

    async def _projection(self, session, identity):
        return await session.scalar(
            select(AssetReferenceSet).where(
                AssetReferenceSet.service_id == "presentation",
                AssetReferenceSet.resource_kind == "project",
                AssetReferenceSet.resource_id == str(identity),
            )
        )

    async def seal(self, *, owner, key, manifest):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            batch = await self._batch(session, owner, key)
            if batch is None or batch.state == "aborted":
                raise conflict("archive_unavailable")
            if batch.manifest_sha256 is not None:
                if batch.manifest_sha256 != manifest.fingerprint:
                    raise conflict("archive_manifest_conflict")
                return batch.state
            staged = await self._files(session, key.batch_id)
            if [(row.ordinal, row.descriptor_sha256) for row in staged] != [
                (entry.ordinal, entry.descriptor_sha256) for entry in manifest.files
            ]:
                raise conflict("archive_files_incomplete")
            if any(
                row.metadata_snapshot["asset"]["media_kind"] not in {"image", "audio", "video"}
                for row in staged
            ):
                raise conflict("archive_media_required")
            wanted, staged_ids = set(manifest.asset_ids), {row.asset_id for row in staged}
            if staged_ids - wanted or await self._projection(session, manifest.project_id):
                raise conflict("archive_reference_mismatch")
            existing = wanted - staged_ids
            present = set(
                await session.scalars(
                    select(VisualAsset.id).where(
                        VisualAsset.id.in_(existing),
                        VisualAsset.project_id.is_(None),
                        VisualAsset.galgame_project_id.is_(None),
                        VisualAsset.video_editor_project_id.is_(None),
                        VisualAsset.motion_compositor_project_id.is_(None),
                        VisualAsset.media_kind.in_(("image", "audio", "video")),
                    )
                )
            )
            if existing != present:
                raise conflict("archive_reference_mismatch")
            projection = AssetReferenceSet(
                id=new_id(),
                owner_user_id=owner,
                service_id="presentation",
                resource_kind="project",
                resource_id=str(manifest.project_id),
                resource_revision=-1,
            )
            session.add(projection)
            await session.flush()
            session.add_all(
                AssetReferencePin(
                    reference_set_id=projection.id, asset_id=asset, owner_user_id=owner
                )
                for asset in sorted(existing)
            )
            batch.projections = [manifest.model_dump(mode="json")]
            batch.manifest_sha256 = manifest.fingerprint
            batch.state = "sealed"
            await session.commit()
            return batch.state

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
            projection = None
            if batch.state == "sealed":
                manifest = PresentationManifest.model_validate(batch.projections[0])
                projection = await self._projection(session, manifest.project_id)
                if projection is None or projection.resource_revision != -1:
                    raise conflict("archive_projection_changed")
            files = [
                VisualAsset(
                    id=file.asset_id, owner_user_id=owner, **file.metadata_snapshot["asset"]
                )
                for file in await self._files(session, key.batch_id)
            ]
            if commit:
                session.add_all(files)
                projection.resource_revision = 0
                await session.flush()
                session.add_all(
                    AssetReferencePin(
                        reference_set_id=projection.id, asset_id=file.id, owner_user_id=owner
                    )
                    for file in files
                )
            else:
                if projection is not None:
                    await session.delete(projection)
                schedule(session, files)
            batch.state = target
            await session.commit()
            return target
