"""Stage a whole Galgame upload before committing its files and receipt."""

from uuid import uuid4

from anyio.to_thread import run_sync
from sqlalchemy import text

from studio.apps.asset_library.galgame.galgame_upload_recovery import settle_stage
from studio.apps.asset_library.library_outputs import VerifiedOutput
from studio.apps.asset_library.scoped_project_files import check_project_scope
from studio.apps.asset_library.scoped_writes import ScopedFileWrites
from studio.apps.asset_library.storage.service_models import (
    GalgameUploadReceipt,
    GalgameUploadStage,
)
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.file_types import GALGAME_EXTENSIONS
from studio.contracts.galgame_workshop.galgame_assets import GalgameAssetFile, MediaInspection
from studio.runtime.files.media_metadata import inspect_media_file
from studio.runtime.http.capability_client import CapabilityUnavailable


class UploadPart:
    def __init__(self, reader, size):
        self.reader, self.remaining = reader, size

    async def read(self, size=-1):
        limit = self.remaining if size < 0 else min(self.remaining, size)
        chunk = await self.reader.read(limit) if limit else b""
        self.remaining -= len(chunk)
        return chunk

    async def close(self):
        pass


class GalgameUploadFiles(ScopedFileWrites):
    service = "galgame"
    receipt_model = GalgameUploadReceipt

    async def require_writable(self):
        await check_project_scope(self.session, self.service, self.project)

    async def journal(self):
        row = await self.session.get(GalgameUploadStage, (self.owner, self.request_id))
        if row is not None and (row.project_id, row.fingerprint) != (
            self.project,
            self.fingerprint,
        ):
            raise AssetError("同一请求标识不能更换内容", code="request_id_conflict", status=409)
        return row

    async def replay(self, admit):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        try:
            prior = await self.prior()
            if prior is not None:
                return prior
            journal = await self.journal()
            if journal is None:
                admit()
            elif journal.state == "aborted":
                raise AssetError("上传已撤销", code="upload_aborted", status=410)
            raise AssetError("上传结果尚未确认", code="upload_unconfirmed", status=404)
        finally:
            await self.session.rollback()

    async def reserve_stage(self, count, admit):
        await self.session.execute(text("BEGIN IMMEDIATE"))
        if await self.prior() is not None:
            await self.session.rollback()
            return None
        admit()
        previous = await self.journal()
        if previous is not None:
            if previous.state == "aborted":
                raise AssetError("上传已撤销", code="upload_aborted", status=410)
            raise AssetError("上传结果尚未确认", code="upload_unconfirmed", status=503)
        await self.require_writable()
        row = GalgameUploadStage(
            owner_user_id=self.owner,
            request_id=self.request_id,
            project_id=self.project,
            fingerprint=self.fingerprint,
            storage_keys=[uuid4().hex for _ in range(count)],
        )
        self.session.add(row)
        await self.session.commit()
        return row

    async def store(self, reader, manifest, maximum, *, admit):
        journal = await self.reserve_stage(len(manifest.files), admit)
        storage_keys = tuple(journal.storage_keys) if journal is not None else ()
        inspection = {}

        def incoming(member):
            return VerifiedOutput(
                UploadPart(reader, member.byte_size),
                member,
                changed=AssetError("上传文件摘要或长度不匹配", code="upload_changed", status=422),
            )

        async def stage():
            for member, key in zip(manifest.files, storage_keys, strict=True):
                row = await self.library.store_upload(
                    incoming(member),
                    owner_user_id=self.owner,
                    galgame_project_id=self.project,
                    allowed_extensions=GALGAME_EXTENSIONS,
                    max_bytes=maximum,
                    defer_persistence=True,
                    reserved_storage_key=key,
                )
                path = self.storage.path_for(row)
                yield row, path
                sha, width, height, duration = await run_sync(
                    inspect_media_file, path, row.media_kind
                )
                inspection[row.storage_key] = MediaInspection(
                    sha256=sha, width=width, height=height, duration_ms=duration
                )
            await reader.require_end(manifest.total_bytes)

        async def verify_previous():
            for member in manifest.files:
                part = incoming(member)
                while await part.read(1024 * 1024):
                    pass
            await reader.require_end(manifest.total_bytes)

        def describe(_project_id, row):
            return GalgameAssetFile(
                **{
                    key: getattr(row, key)
                    for key in GalgameAssetFile.model_fields
                    if key not in {"exists", "inspection"}
                },
                exists=True,
                inspection=inspection[row.storage_key],
            ).model_dump(mode="json")

        self.record = describe
        try:
            return await self.write(stage, verify_previous=verify_previous)
        except CapabilityUnavailable as exc:
            raise AssetError("上传流不完整", code="upload_changed", status=422) from exc
        finally:
            if journal is not None:
                current = await self.journal()
                if current is not None:
                    await settle_stage(self.session, self.storage, current)
