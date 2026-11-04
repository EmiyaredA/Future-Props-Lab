"""Stage Models output bytes outside writes, then atomically publish file and receipt."""

import hashlib

from sqlalchemy import select, text

from app.capabilities.asset_store.asset_outputs import asset_out
from app.capabilities.asset_store.errors import AssetError
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.schemas.files import VisualAssetOut
from app.capabilities.asset_store.storage import AssetStorage

from .models import ModelLibraryOutputReceipt


class VerifiedOutput:
    def __init__(self, incoming, description, *, changed=None):
        self.incoming, self.description = incoming, description
        self.filename, self.content_type = description.filename, description.mime_type
        self.received, self.digest = 0, hashlib.sha256()
        self.changed = changed

    async def read(self, size=-1):
        chunk = await self.incoming.read(size)
        if size == 0:
            return chunk
        self.received += len(chunk)
        self.digest.update(chunk)
        if self.received > self.description.byte_size or (
            not chunk
            and (
                self.received != self.description.byte_size
                or self.digest.hexdigest() != self.description.content_sha256
            )
        ):
            raise self.changed or AssetError(
                "模型结果摘要或长度不匹配", code="output_changed", status=422
            )
        return chunk

    async def close(self):
        await self.incoming.close()


class LibraryOutputFiles:
    def __init__(self, session, settings, owner, *, active):
        if session.info.get("owner_user_id") != owner:
            raise ValueError("素材结果缺少匹配的账号上下文")
        self.session, self.settings, self.owner, self.active = session, settings, owner, active

    async def _receipt(self, task_id, description):
        row = await self.session.scalar(
            select(ModelLibraryOutputReceipt).where(
                ModelLibraryOutputReceipt.owner_user_id == self.owner,
                ModelLibraryOutputReceipt.source_task_id == task_id,
                ModelLibraryOutputReceipt.descriptor_sha256 == description.fingerprint,
            )
        )
        if row is None:
            return None
        if await self.session.get(VisualAsset, row.result["id"]) is None:
            raise AssetError(
                "此模型结果已保存的文件已被删除", code="library_output_removed", status=409
            )
        return VisualAssetOut.model_validate(row.result)

    async def _authorize(self):
        active = await self.active()
        if active is not True:
            raise AssetError(
                "结果保存授权已撤销" if active is False else "结果保存授权暂不可用",
                code="library_output_revoked" if active is False else "identity_unavailable",
                status=401 if active is False else 503,
            )

    async def store(self, task_id, description, incoming, *, folder_id=None, verify_replay=False):
        staged_path = None
        committing = False
        try:
            await self._authorize()
            previous = await self._receipt(task_id, description)
            await self.session.rollback()
            if previous is not None:
                if verify_replay:
                    verified = VerifiedOutput(incoming, description)
                    while await verified.read(1024 * 1024):
                        pass
                return previous
            row = await AssetLibrary(self.session, self.settings).store_upload(
                VerifiedOutput(incoming, description),
                owner_user_id=self.owner,
                folder_id=folder_id,
                defer_persistence=True,
            )
            staged_path = AssetStorage(self.settings).path_for(row)
            if row.byte_size != description.byte_size or row.mime_type != description.mime_type:
                raise AssetError("模型结果描述与文件内容不一致", code="output_changed", status=422)
            # The potentially large stream finishes before the short SQLite writer is opened.
            await self._authorize()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            previous = await self._receipt(task_id, description)
            if previous is not None:
                await self.session.rollback()
                staged_path.unlink(missing_ok=True)
                return previous
            self.session.add(row)
            await self.session.flush()
            result = asset_out(row)
            self.session.add(
                ModelLibraryOutputReceipt(
                    owner_user_id=self.owner,
                    source_task_id=task_id,
                    descriptor_sha256=description.fingerprint,
                    content_sha256=description.content_sha256,
                    result=result.model_dump(mode="json"),
                )
            )
            committing = True
            await self.session.commit()
            return result
        except BaseException:
            await self.session.rollback()
            if staged_path is not None and not committing:
                staged_path.unlink(missing_ok=True)
            # An unknown commit keeps its staged file. Retry reads the original durable receipt.
            raise
        finally:
            await incoming.close()
