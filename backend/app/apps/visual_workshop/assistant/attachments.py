from __future__ import annotations

import asyncio
import base64

from sqlalchemy import select

from app.apps.visual_workshop.assistant_input_values import (
    attachment_metadata,
    content_projection,
    message_input,
    normalize_content_parts,
)
from app.capabilities.agents.harness.contracts import ImageInput
from app.capabilities.asset_store.assistant_media import (
    ALLOWED_IMAGE_TYPES,
    ALLOWED_MEDIA_KINDS,
    MAX_IMAGE_BYTES,
    read_document,
    read_image,
)
from app.capabilities.asset_store.assistant_media import (
    AssistantAssetError as AssistantAssetError,
)
from app.capabilities.asset_store.models import (
    VisualAsset,
    VisualProjectAssetReference,
)

MAX_ATTACHMENTS = 5


class VisualAssistantAttachmentMixin:
    async def _project_assets(self, project_id: str, asset_ids: list[str]) -> list[VisualAsset]:
        if not asset_ids:
            return []
        if len(asset_ids) > MAX_ATTACHMENTS:
            raise AssistantAssetError("每条消息最多添加 5 个附件")
        rows = list(
            (await self.session.execute(select(VisualAsset).where(VisualAsset.id.in_(asset_ids))))
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        references = set(
            (
                await self.session.execute(
                    select(VisualProjectAssetReference.asset_id).where(
                        VisualProjectAssetReference.project_id == project_id,
                        VisualProjectAssetReference.asset_id.in_(asset_ids),
                    )
                )
            ).scalars()
        )
        result: list[VisualAsset] = []
        for asset_id in asset_ids:
            asset = by_id.get(asset_id)
            if asset is None or not (
                asset.project_id == project_id
                or (asset.project_id is None and asset.id in references)
            ):
                raise AssistantAssetError("附件不存在或不属于当前项目", code="scope_mismatch")
            if asset.media_kind not in ALLOWED_MEDIA_KINDS:
                raise AssistantAssetError("不支持此附件类型")
            if asset.media_kind == "image" and asset.byte_size > MAX_IMAGE_BYTES:
                raise AssistantAssetError("图片不能超过 8MB", code="file_too_large", status=413)
            if (
                asset.media_kind != "image"
                and asset.byte_size > self.settings.fpl_visual_asset_max_bytes
            ):
                raise AssistantAssetError(
                    "附件超过项目文件大小限制", code="file_too_large", status=413
                )
            result.append(asset)
        return result

    _normalize_content_parts = staticmethod(normalize_content_parts)
    _content_projection = staticmethod(content_projection)

    async def _images(self, assets: list[VisualAsset]) -> tuple[ImageInput, ...]:
        async def encode(asset: VisualAsset) -> ImageInput:
            path = self.storage.path_for(asset)
            content, mime_type = await asyncio.to_thread(
                read_image, path, asset.mime_type, asset.display_name
            )
            return ImageInput(
                mime_type=mime_type,
                data_base64=base64.b64encode(content).decode("ascii"),
                byte_size=len(content),
            )

        return tuple(await asyncio.gather(*(encode(asset) for asset in assets)))

    _attachment_metadata = staticmethod(attachment_metadata)

    async def _document_text(self, asset: VisualAsset) -> tuple[str, str | None]:
        path = self.storage.path_for(asset)
        return await asyncio.to_thread(read_document, path, asset.mime_type, asset.display_name)

    async def _message_input(
        self,
        content: str,
        assets: list[VisualAsset],
        content_parts: list[dict] | None = None,
    ) -> tuple[str, tuple[ImageInput, ...], tuple[str, ...]]:
        vision_assets = [
            asset
            for asset in assets
            if asset.media_kind == "image" and asset.mime_type in ALLOWED_IMAGE_TYPES
        ]
        images = dict(
            zip(
                (asset.id for asset in vision_assets),
                await self._images(vision_assets),
                strict=True,
            )
        )
        documents = {
            asset.id: await self._document_text(asset)
            for asset in assets
            if asset.media_kind == "document"
        }
        return message_input(content, assets, content_parts, images, documents)
