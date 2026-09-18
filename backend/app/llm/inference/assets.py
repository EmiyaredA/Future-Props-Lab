import asyncio
from pathlib import Path
from uuid import uuid4

from sqlalchemy import delete, select

from app.capabilities.asset_store import AssetStorage, IncomingFile
from app.capabilities.asset_store.library import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.policy import ALLOWED_FILES, looks_like, validate_file_structure
from app.llm.models.model_inference import ModelInferenceAsset
from app.llm.schemas.model_inference import InferenceAssetOut
from app.runtime.config import get_settings


def root(workspace_id):
    return get_settings().workspace_path(workspace_id) / "model-inference"


class LocalInput:
    def __init__(self, path, filename, mime_type):
        self.filename, self.content_type = filename, mime_type
        self._source = Path(path).open("rb")

    async def read(self, size=-1):
        return await asyncio.to_thread(self._source.read, size)

    async def close(self):
        self._source.close()


class InferenceAssets:
    def __init__(self, session, workspace_id):
        self.session, self.workspace_id = session, workspace_id

    async def get(self, asset_id):
        row = await self.session.scalar(
            select(ModelInferenceAsset).where(
                ModelInferenceAsset.id == asset_id,
                ModelInferenceAsset.workspace_id == self.workspace_id,
            )
        )
        if row is None:
            raise AssetError("输入素材不存在", code="not_found", status=404)
        return row

    async def upload(self, upload: IncomingFile):
        filename = Path(upload.filename or "").name
        suffix = Path(filename).suffix.lower()
        policy = ALLOWED_FILES.get(suffix)
        if not policy or policy[0] not in {"image", "audio", "video"} or suffix == ".svg":
            raise AssetError("独立调用仅接受图片、音频或视频输入")
        mime = (upload.content_type or "application/octet-stream").lower()
        if mime not in policy[1] and mime != "application/octet-stream":
            raise AssetError("输入 MIME 与扩展名不一致")
        key = uuid4().hex
        path = root(self.workspace_id) / "inputs" / key
        path.parent.mkdir(parents=True, exist_ok=True)
        # End the authentication/read transaction before copying potentially large inputs.
        await self.session.rollback()
        size, head = 0, bytearray()
        committing = False
        try:
            with path.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > get_settings().fpl_visual_asset_max_bytes:
                        raise AssetError("输入素材超过上传上限", status=413)
                    if len(head) < 512:
                        head.extend(chunk[: 512 - len(head)])
                    target.write(chunk)
            if not size or not looks_like(suffix, bytes(head)):
                raise AssetError("文件内容与类型不匹配")
            if not await asyncio.to_thread(validate_file_structure, path, suffix):
                raise AssetError("文件内容损坏")
            row = ModelInferenceAsset(
                workspace_id=self.workspace_id,
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
        asset = await self.session.scalar(
            select(VisualAsset).where(
                VisualAsset.id == asset_id,
                VisualAsset.workspace_id == self.workspace_id,
                VisualAsset.project_id.is_(None),
                VisualAsset.galgame_project_id.is_(None),
                VisualAsset.video_editor_project_id.is_(None),
            )
        )
        if asset is None:
            raise AssetError("公共文件不存在", code="not_found", status=404)
        incoming = LocalInput(
            AssetStorage(get_settings()).path_for(asset), asset.original_filename, asset.mime_type
        )
        try:
            return await self.upload(incoming)
        finally:
            await incoming.close()

    async def delete(self, asset_id):
        row = await self.get(asset_id)
        if row.task_id:
            raise AssetError("输入已被任务认领", code="asset_in_use", status=409)
        path = root(self.workspace_id) / "inputs" / row.storage_key
        result = await self.session.execute(
            delete(ModelInferenceAsset).where(
                ModelInferenceAsset.id == asset_id,
                ModelInferenceAsset.workspace_id == self.workspace_id,
                ModelInferenceAsset.task_id.is_(None),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            raise AssetError("输入已被任务认领或删除", code="asset_in_use", status=409)
        await self.session.commit()
        path.unlink(missing_ok=True)
