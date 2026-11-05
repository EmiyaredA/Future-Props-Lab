"""Compatibility site's library validation and project reference projection."""

from contextlib import asynccontextmanager
from types import SimpleNamespace

from sqlalchemy import delete, select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.presentation_workshop.asset_references import document_references, validate_assets
from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.storage.models import PresentationAssetReference
from studio.apps.presentation_workshop.templates.models import (
    PresentationExampleAsset,
    PresentationTemplateAsset,
)
from studio.runtime.files.svg import normalize_svg


class LegacyProjectAssets:
    export_output_root = None

    def __init__(self, session, owner_user_id, *, storage: AssetStorage):
        self.session, self.owner_user_id = session, owner_user_id
        self.storage = storage

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
        path = self.storage.path_for(row)
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

    async def library_references(self, kind, identity, assets):
        model, key = (
            (PresentationTemplateAsset, "template_id")
            if kind == "templates"
            else (PresentationExampleAsset, "example_id")
        )
        await self.session.execute(delete(model).where(getattr(model, key) == identity))
        self.session.add_all(model(**{key: identity, "asset_id": asset.id}) for asset in assets)

    @asynccontextmanager
    async def export_sources(self, rows):
        sources = [
            (
                SimpleNamespace(
                    id=row.id, original_filename=row.original_filename, mime_type=row.mime_type
                ),
                self.storage.path_for(row),
            )
            for row in rows
        ]
        await self.session.rollback()
        yield sources
