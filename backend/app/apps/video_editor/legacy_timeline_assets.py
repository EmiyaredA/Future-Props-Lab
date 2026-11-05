"""Read compatibility-site clip metadata from the same account and project."""

from sqlalchemy import select

from app.capabilities.asset_store.models import VisualAsset

from .models import VideoEditorAssetMetadata
from .timeline_assets import TimelineAsset


class LegacyTimelineAssets:
    def __init__(self, session, owner):
        self.session, self.owner = session, owner

    async def describe(self, project_id, identities):
        rows = (
            await self.session.execute(
                select(VisualAsset, VideoEditorAssetMetadata)
                .join(VideoEditorAssetMetadata, VideoEditorAssetMetadata.asset_id == VisualAsset.id)
                .where(
                    VisualAsset.id.in_(identities),
                    VisualAsset.owner_user_id == self.owner,
                    VisualAsset.video_editor_project_id == project_id,
                    VideoEditorAssetMetadata.project_id == project_id,
                )
            )
        ).all()
        return {
            asset.id: TimelineAsset.from_metadata(asset.media_kind, metadata)
            for asset, metadata in rows
        }

    async def guard_write(self, _project_id):
        # Compatibility reads and writes the document and metadata in one database.
        pass
