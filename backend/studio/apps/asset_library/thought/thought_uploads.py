"""Same-account Thought upload receipt and file commit in one Assets transaction."""

from sqlalchemy import select, text

from app.capabilities.asset_store.asset_outputs import asset_out
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import ATTACHMENT_EXTENSIONS
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.asset_library.library_outputs import VerifiedOutput
from studio.apps.asset_library.storage.service_models import ThoughtUploadReceipt
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.files import VisualAssetOut

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp"}


class ThoughtUploads:
    def __init__(self, session, settings, owner, *, active):
        if session.info.get("owner_user_id") != owner:
            raise ValueError("思绪附件缺少匹配的账号上下文")
        self.session, self.settings, self.owner, self.active = session, settings, owner, active

    async def receipt(self, request_id, description):
        row = await self.session.scalar(
            select(ThoughtUploadReceipt).where(
                ThoughtUploadReceipt.owner_user_id == self.owner,
                ThoughtUploadReceipt.request_id == request_id,
            )
        )
        if row is None:
            return None
        if row.descriptor_sha256 != description.fingerprint:
            raise AssetError("上传请求标识已用于其他文件", code="request_id_conflict", status=409)
        if await self.session.get(VisualAsset, row.result["id"]) is None:
            raise AssetError("上传文件已删除", code="upload_removed", status=409)
        return VisualAssetOut.model_validate(row.result)

    async def authorize(self):
        active = await self.active()
        if active is not True:
            raise AssetError(
                "上传授权已撤销" if active is False else "上传授权暂不可用",
                code="upload_revoked" if active is False else "identity_unavailable",
                status=401 if active is False else 503,
            )

    async def store(self, request_id, description, incoming):
        staged_path = None
        committing = False
        try:
            await self.authorize()
            previous = await self.receipt(request_id, description)
            await self.session.rollback()
            if previous is not None:
                return previous
            row = await AssetLibrary(self.session, self.settings).store_upload(
                VerifiedOutput(incoming, description),
                owner_user_id=self.owner,
                allowed_extensions=IMAGE_EXTENSIONS
                if description.kind == "image"
                else ATTACHMENT_EXTENSIONS,
                defer_persistence=True,
            )
            staged_path = AssetStorage(self.settings).path_for(row)
            if row.byte_size != description.byte_size:
                raise AssetError("上传文件长度不匹配", code="upload_changed", status=422)
            await self.authorize()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            previous = await self.receipt(request_id, description)
            if previous is not None:
                await self.session.rollback()
                staged_path.unlink(missing_ok=True)
                return previous
            self.session.add(row)
            await self.session.flush()
            result = asset_out(row)
            self.session.add(
                ThoughtUploadReceipt(
                    owner_user_id=self.owner,
                    request_id=request_id,
                    descriptor_sha256=description.fingerprint,
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
            raise
        finally:
            await incoming.close()
