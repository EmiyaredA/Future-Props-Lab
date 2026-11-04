"""Compatibility site's library validation and project reference projection."""

from sqlalchemy import delete, select

from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.asset_store.svg import normalize_svg
from app.runtime.config import get_settings

from .asset_references import document_references, validate_assets
from .models import PresentationAssetReference
from .schemas.document import PresentationDocument


class LegacyProjectAssets:
    def __init__(self, session, owner_user_id):
        self.session, self.owner_user_id = session, owner_user_id

    async def assets(self, document: PresentationDocument) -> list[VisualAsset]:
        references = document_references(document)
        ids = set(references)
        if not ids:
            return []
        rows = list(
            await self.session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.owner_user_id == self.owner_user_id,
                    VisualAsset.project_id.is_(None),
                    VisualAsset.galgame_project_id.is_(None),
                    VisualAsset.video_editor_project_id.is_(None),
                    VisualAsset.motion_compositor_project_id.is_(None),
                    VisualAsset.media_kind.in_(["image", "audio", "video"]),
                )
            )
        )
        return await validate_assets(document, rows, monochrome=self.monochrome)

    async def monochrome(self, row):
        path = AssetStorage(get_settings()).path_for(row)
        return normalize_svg(path.read_text())["monochrome"]

    async def references(self, project_id: str, assets):
        await self.session.execute(
            delete(PresentationAssetReference).where(
                PresentationAssetReference.project_id == project_id
            )
        )
        self.session.add_all(
            PresentationAssetReference(project_id=project_id, asset_id=a.id) for a in assets
        )
