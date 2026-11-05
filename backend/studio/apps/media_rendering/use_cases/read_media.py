"""Read-only derivations do not publish assets or mutate the source revision."""

from studio.apps.media_rendering.ports import MediaAuthorization, MediaProcessor, MediaSources
from studio.contracts.asset_library.errors import AssetError
from studio.contracts.media_rendering.image_crop import ImageCropIn


class ReadMedia:
    def __init__(
        self, sources: MediaSources, processor: MediaProcessor, access: MediaAuthorization
    ):
        self.sources, self.processor, self.access = sources, processor, access

    @staticmethod
    def _owned(source, owner, asset_id):
        if source.description.owner_user_id != owner or source.description.id != asset_id:
            raise AssetError("文件不存在", code="not_found", status=404)

    async def crop(self, owner: str, asset_id: str, body: ImageCropIn) -> bytes:
        async with self.sources.borrow(owner, asset_id) as source:
            self._owned(source, owner, asset_id)
            info = source.description
            if info.media_kind != "image" or info.mime_type == "image/svg+xml":
                raise AssetError("裁剪需要栅格图片；SVG 请先通过预览接口转换")
            output = await self.processor.crop(source, body)
            await self.access.ensure_active()
            return output

    async def video_info(self, owner: str, asset_id: str) -> dict:
        async with self.sources.borrow(owner, asset_id) as source:
            self._owned(source, owner, asset_id)
            if source.description.media_kind != "video":
                raise AssetError("格式检查只支持视频文件")
            output = await self.processor.video_info(source)
            await self.access.ensure_active()
            return output
