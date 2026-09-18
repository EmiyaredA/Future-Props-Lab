from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.library import AssetError, AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from app.models import VisualAsset, VisualAssetFolder, VisualWorkshopProject
from app.runtime.config import Settings


class VisualAssetContext:
    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.settings = settings
        self.workspace_id = workspace_id
        self.storage = AssetStorage(settings)
        self.library = AssetLibrary(session, settings)

    async def _project(self, project_id: str) -> None:
        if await self.session.get(VisualWorkshopProject, project_id) is None:
            raise AssetError("项目不存在", code="not_found", status=404)

    async def _folder(self, folder_id: str) -> VisualAssetFolder:
        row = await self.session.get(VisualAssetFolder, folder_id)
        if row is None:
            raise AssetError("文件夹不存在", code="not_found", status=404)
        return row

    async def _asset(self, asset_id: str) -> VisualAsset:
        row = await self.session.get(VisualAsset, asset_id)
        if row is None:
            raise AssetError("文件不存在", code="not_found", status=404)
        return row

    async def _validate_folder_scope(
        self, folder_id: str | None, project_id: str | None
    ) -> VisualAssetFolder | None:
        if folder_id is None:
            return None
        folder = await self._folder(folder_id)
        if folder.project_id != project_id:
            raise AssetError("文件夹不属于当前文件域", code="scope_mismatch")
        return folder
