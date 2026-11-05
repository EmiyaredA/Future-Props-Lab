import asyncio
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select

from studio.apps.model_service.inference.storage import InferenceStorage
from studio.apps.model_service.inference.storage import root as root
from studio.apps.model_service.library.inputs import ExactInput
from studio.apps.model_service.library.inputs import LocalInput as LocalInput
from studio.apps.model_service.storage.models.model_inference import ModelInferenceAsset
from studio.config.settings import get_settings
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.asset_library.file_types import ALLOWED_FILES
from studio.contracts.asset_library.incoming import IncomingFile
from studio.contracts.model_service.schemas.model_inference import InferenceAssetOut
from studio.runtime.files.content_types import looks_like
from studio.runtime.files.inspection import validate_file_structure


class InferenceAssets:
    def __init__(self, session, owner_user_id, *, settings=None, library=None):
        self.session, self.owner_user_id = session, owner_user_id
        self.settings = settings or get_settings()
        self.storage = InferenceStorage(self.settings)
        self.library = library

    async def get(self, asset_id):
        row = await self.session.scalar(
            select(ModelInferenceAsset).where(
                ModelInferenceAsset.id == asset_id,
                ModelInferenceAsset.owner_user_id == self.owner_user_id,
            )
        )
        if row is None:
            raise AssetError("输入素材不存在", code="not_found", status=404)
        return row

    async def upload(self, upload: IncomingFile):
        if self.session.info.get("owner_user_id") != self.owner_user_id:
            raise AssetError(
                "模型输入缺少匹配的账号上下文", code="account_context_mismatch", status=403
            )
        filename = Path(upload.filename or "").name
        suffix = Path(filename).suffix.lower()
        policy = ALLOWED_FILES.get(suffix)
        if not policy or policy[0] not in {"image", "audio", "video"} or suffix == ".svg":
            raise AssetError("独立调用仅接受图片、音频或视频输入")
        mime = (upload.content_type or "application/octet-stream").lower()
        if mime not in policy[1] and mime != "application/octet-stream":
            raise AssetError("输入 MIME 与扩展名不一致")
        key = uuid4().hex
        path = self.storage.root(self.owner_user_id) / "inputs" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        # End the authentication/read transaction before copying potentially large inputs.
        await self.session.rollback()
        size, head = 0, bytearray()
        committing = False
        try:
            with path.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.settings.fpl_visual_asset_max_bytes:
                        raise AssetError("输入素材超过上传上限", status=413)
                    if len(head) < 512:
                        head.extend(chunk[: 512 - len(head)])
                    target.write(chunk)
            if not size or not looks_like(suffix, bytes(head)):
                raise AssetError("文件内容与类型不匹配")
            if not await asyncio.to_thread(validate_file_structure, path, suffix):
                raise AssetError("文件内容损坏")
            row = ModelInferenceAsset(
                owner_user_id=self.owner_user_id,
                storage_key=key,
                filename=filename,
                mime_type=sorted(policy[1])[0] if mime == "application/octet-stream" else mime,
                media_kind=policy[0],
                byte_size=size,
            )
            self.session.add(row)
            committing = True
            await self.session.commit()
            return InferenceAssetOut.model_validate(row)
        except BaseException:
            await self.session.rollback()
            if not committing:
                path.unlink(missing_ok=True)
            # An interrupted commit may already own this file; startup checks unreferenced inputs.
            raise

    async def import_library(self, asset_id):
        if self.session.info.get("owner_user_id") != self.owner_user_id:
            raise AssetError(
                "模型输入缺少匹配的账号上下文", code="account_context_mismatch", status=403
            )
        if self.library is None:
            raise AssetError(
                "模型素材读取接口未装配", code="model_library_inputs_unavailable", status=503
            )
        await self.session.rollback()
        async with self.library.open(asset_id) as source:
            if source.asset_id != asset_id or source.byte_size < 1:
                raise AssetError("来源素材描述不匹配", code="invalid_source")
            policy = ALLOWED_FILES.get(Path(source.incoming.filename or "").suffix.lower())
            if policy is None or policy[0] != source.media_kind:
                raise AssetError("来源素材类型与文件名不匹配", code="invalid_source")
            if source.byte_size > self.settings.fpl_visual_asset_max_bytes:
                raise AssetError("输入素材超过上传上限", status=413)
            return await self.upload(ExactInput(source.incoming, source.byte_size))

    async def delete(self, asset_id):
        row = await self.get(asset_id)
        if row.task_id:
            raise AssetError("输入已被任务认领", code="asset_in_use", status=409)
        path = self.storage.root(self.owner_user_id) / "inputs" / row.storage_key
        result = await self.session.execute(
            delete(ModelInferenceAsset).where(
                ModelInferenceAsset.id == asset_id,
                ModelInferenceAsset.owner_user_id == self.owner_user_id,
                ModelInferenceAsset.task_id.is_(None),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise AssetError("输入已被任务认领或删除", code="asset_in_use", status=409)
        await self.session.commit()
        path.unlink(missing_ok=True)
