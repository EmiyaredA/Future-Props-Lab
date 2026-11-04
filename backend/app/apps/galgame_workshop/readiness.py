from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.assets.assets import GalgameProjectAssets
from app.apps.galgame_workshop.errors import GalgameStoryDocumentInvalidError
from app.apps.galgame_workshop.models import GalgameAssetMetadata
from app.apps.galgame_workshop.schemas import (
    GalgameStoryRouteReportOut,
)
from app.apps.galgame_workshop.story.readiness_values import (
    complete_readiness,
    invalid_asset_reference,
)
from app.apps.galgame_workshop.story.route_report import build_route_report
from app.apps.galgame_workshop.story.story import GalgameStoryDocuments
from app.capabilities.asset_store.storage import AssetStorage
from app.runtime.config import Settings


class GalgameReadiness:
    """Composes Story control-flow checks with the asset package manifest."""

    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id

    async def report(self, project_id: str) -> GalgameStoryRouteReportOut:
        stories = GalgameStoryDocuments(self.session)
        story = await stories.get(project_id)
        report = build_route_report(project_id, story.revision, story.document)
        try:
            rows = await stories._asset_rows(project_id, story.document)
        except GalgameStoryDocumentInvalidError as exc:
            return invalid_asset_reference(report, str(exc))

        storage = AssetStorage(self.settings)
        missing = [
            asset
            for asset in story.document.assets
            if not storage.path_for(rows[asset.file_id]).is_file()
        ]

        durations = {}
        assets_by_id = {asset.id: asset for asset in story.document.assets}
        for chapter in story.document.chapters:
            for fragment in chapter.fragments:
                master = fragment.timeline.master_audio if fragment.timeline else None
                if master is None:
                    continue
                file_id = assets_by_id[master.asset_id].file_id
                metadata = await self.session.get(GalgameAssetMetadata, file_id)
                if metadata is not None:
                    durations[file_id] = metadata.duration_ms
        manifest = await GalgameProjectAssets(
            self.session, self.settings, self.owner_user_id
        ).package_manifest(project_id)
        return complete_readiness(
            report,
            story.document,
            missing_ids={asset.file_id for asset in missing},
            durations=durations,
            manifest=manifest,
        )
