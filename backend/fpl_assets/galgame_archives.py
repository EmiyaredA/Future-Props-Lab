"""Publish Galgame originals and their initial Story pins after an exact source decision."""

from fpl_runtime.galgame_snapshot import GalgameArchiveManifest

from .models import AssetReferencePin, GalgameArchiveBatch, GalgameArchiveFile
from .motion_archives import PortableProjectArchives


class GalgameArchives(PortableProjectArchives):
    service = "galgame"
    project_column = "galgame_project_id"
    resource_kind = "story"
    manifest_type = GalgameArchiveManifest
    batch_model = GalgameArchiveBatch
    file_model = GalgameArchiveFile
    allowed_extensions = None

    async def publish_project(self, session, owner, manifest, files):
        projection = await super().publish_project(session, owner, manifest, files)
        await session.flush()
        session.add_all(
            AssetReferencePin(
                owner_user_id=owner, reference_set_id=projection.id, asset_id=files[ordinal].id
            )
            for ordinal in manifest.story_ordinals
        )
