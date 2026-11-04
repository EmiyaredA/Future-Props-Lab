"""Private, verified staging for archive imports owned by separate services."""

from sqlalchemy import func, select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.ids import new_id

from .library_outputs import VerifiedOutput

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


class ArchiveFileStaging:
    batch_byte_limit = None

    def __init__(self, database, settings):
        self.database, self.settings = database, settings

    async def _batch(self, session, owner, key):
        batch = await session.get(self.batch_model, (owner, key.batch_id))
        if batch is not None and batch.source_sha256 != key.source_sha256:
            raise conflict()
        return batch

    def _new_batch(self, session, owner, key):
        row = self.batch_model(
            owner_user_id=owner, batch_id=key.batch_id, source_sha256=key.source_sha256
        )
        session.add(row)
        return row

    async def _files(self, session, batch_id):
        return list(
            await session.scalars(
                select(self.file_model)
                .where(self.file_model.batch_id == batch_id)
                .order_by(self.file_model.ordinal)
            )
        )

    async def _prior_file(self, session, owner, batch, ordinal, description):
        if batch is None:
            return None
        if batch.state == "aborted":
            raise conflict("archive_aborted")
        file = await session.get(self.file_model, (owner, batch.batch_id, ordinal))
        if file is None:
            if batch.state != "staging":
                raise conflict()
            return None
        if file.descriptor_sha256 != description.fingerprint:
            raise conflict("archive_file_conflict")
        return file.metadata_snapshot["result"]

    async def _check_batch_limit(self, session, key, row):
        if self.batch_byte_limit is None:
            return
        total = await session.scalar(
            select(
                func.sum(self.file_model.metadata_snapshot["asset"]["byte_size"].as_integer())
            ).where(self.file_model.batch_id == key.batch_id)
        )
        if (total or 0) + row.byte_size > self.batch_byte_limit:
            raise AssetError("归档素材总量超限", code="archive_media_too_large", status=413)

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
                    allowed_extensions=self.allowed_extensions,
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
                await self._check_batch_limit(session, key, row)
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
                    self.file_model(
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
