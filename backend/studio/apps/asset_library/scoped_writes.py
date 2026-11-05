"""Store project uploads and copies with exact, account-scoped Assets receipts."""

from sqlalchemy import select, text

from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import VIDEO_EDITABLE_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.motion.motion_files import file_record
from studio.apps.asset_library.storage.service_models import (
    MotionFileWriteReceipt,
    VideoFileWriteReceipt,
)
from studio.apps.asset_library.video.video_files import record as video_file_record
from studio.contracts.motion_compositor.motion_assets import MOTION_EXTENSIONS

from .library_outputs import VerifiedOutput
from .scoped_project_files import check_writable


class ScopedFileWrites:
    def __init__(self, session, settings, owner, project, request_id, fingerprint, *, active):
        if session.info.get("owner_user_id") != owner:
            raise ValueError("项目素材写入缺少匹配的账号上下文")
        self.session, self.owner, self.project = session, owner, project
        self.request_id, self.fingerprint, self.active = request_id, fingerprint, active
        self.library = AssetLibrary(session, settings)
        self.storage = AssetStorage(settings)

    async def require_writable(self):
        await check_writable(self.session, self.service, self.project)

    async def prior(self):
        row = await self.session.get(self.receipt_model, (self.owner, self.request_id))
        if row is None:
            return None
        if (row.project_id, row.fingerprint) != (self.project, self.fingerprint):
            raise AssetError("同一请求标识不能更换内容", code="request_id_conflict", status=409)
        return row.result

    async def store_upload(self, description, incoming, *, max_bytes=None):
        async def stage():
            row = await self.library.store_upload(
                VerifiedOutput(incoming, description),
                owner_user_id=self.owner,
                allowed_extensions=self.extensions,
                max_bytes=max_bytes,
                **{self.project_column: self.project},
                defer_persistence=True,
            )
            yield row, self.storage.path_for(row)

        async def verify_previous():
            checked = VerifiedOutput(incoming, description)
            while await checked.read(1024 * 1024):
                pass

        try:
            return (await self.write(stage, verify_previous=verify_previous))[0]
        finally:
            await incoming.close()

    def copy_query(self, ids):
        return select(VisualAsset).where(
            VisualAsset.owner_user_id == self.owner, VisualAsset.id.in_(ids)
        )

    async def copy(self, ids):
        async def stage():
            sources = list(
                await self.session.scalars(self.copy_query(ids).order_by(VisualAsset.id))
            )
            if {row.id for row in sources} != set(ids):
                raise AssetError(
                    "有素材不存在或不属于当前账号", code=self.invalid_source, status=422
                )
            files = [
                (self.storage.path_for(row), row.original_filename, row.mime_type)
                for row in sources
            ]
            await self.session.rollback()
            for path, filename, mime in files:
                if path.is_symlink():
                    raise AssetError("源文件内容不存在", code="not_found", status=404)
                yield await self.library.stage_local_copy(
                    path,
                    owner_user_id=self.owner,
                    **{self.project_column: self.project},
                    filename=filename,
                    content_type=mime,
                    allowed_extensions=self.extensions,
                    defer_persistence=True,
                )

        return await self.write(stage)

    async def write(self, stage, *, verify_previous=None):
        staged = []
        committing = False
        try:
            await self.active()
            previous = await self.prior()
            if previous is None:
                await self.require_writable()
            await self.session.rollback()
            if previous is not None:
                if verify_previous is not None:
                    await verify_previous()
                return previous
            async for row, path in stage():
                staged.append((row, path))
            await self.active()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            previous = await self.prior()
            if previous is not None:
                await self.session.rollback()
                return previous
            await self.require_writable()
            self.session.add_all(row for row, _ in staged)
            await self.session.flush()
            result = [self.record(self.project, row) for row, _ in staged]
            self.session.add(
                self.receipt_model(
                    owner_user_id=self.owner,
                    request_id=self.request_id,
                    project_id=self.project,
                    fingerprint=self.fingerprint,
                    result=result,
                )
            )
            committing = True
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            raise
        finally:
            if not committing:
                for _, path in staged:
                    path.unlink(missing_ok=True)


class MotionFileWrites(ScopedFileWrites):
    service = "motion"
    project_column = "motion_compositor_project_id"
    receipt_model = MotionFileWriteReceipt
    extensions = MOTION_EXTENSIONS
    record = staticmethod(file_record)
    invalid_source = "invalid_motion"


class VideoFileWrites(ScopedFileWrites):
    service = "video"
    project_column = "video_editor_project_id"
    receipt_model = VideoFileWriteReceipt
    extensions = VIDEO_EDITABLE_EXTENSIONS
    record = staticmethod(video_file_record)
    invalid_source = "invalid_asset"

    def copy_query(self, ids):
        return super().copy_query(ids).where(VisualAsset.video_editor_project_id.is_(None))
