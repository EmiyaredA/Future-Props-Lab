"""Publish Visual archive files, folders and project-scoped pins atomically."""

from app.capabilities.asset_store.models import VisualAssetFolder
from studio.apps.asset_library.motion.motion_archives import PortableProjectArchives
from studio.apps.asset_library.storage.service_models import (
    AssetReferencePin,
    AssetReferenceSet,
    VisualArchiveBatch,
    VisualArchiveFile,
)
from studio.contracts.visual_workshop.visual_snapshot import VisualArchiveManifest


class VisualArchives(PortableProjectArchives):
    service = "visual"
    project_column = "project_id"
    resource_kind = "canvas"
    manifest_type = VisualArchiveManifest
    batch_model = VisualArchiveBatch
    file_model = VisualArchiveFile
    allowed_extensions = None

    def upload_placement(self, placement):
        return {"visual_project_id": placement["project_id"]}

    async def publish_project(self, session, owner, manifest, files):
        project = str(manifest.project_id)
        for folder in manifest.folders:
            session.add(
                VisualAssetFolder(
                    id=folder.id,
                    owner_user_id=owner,
                    project_id=project,
                    parent_id=folder.parent_id,
                    name=folder.name,
                )
            )
        await session.flush()
        for file, folder_id in zip(files, manifest.file_folders, strict=True):
            file.folder_id = folder_id
        canvas = await super().publish_project(session, owner, manifest, files)
        acceptance = AssetReferenceSet(
            owner_user_id=owner,
            service_id="visual",
            resource_kind="acceptance",
            resource_id=project,
            resource_revision=0,
        )
        session.add(acceptance)
        await session.flush()
        for projection, ordinals in (
            (canvas, manifest.canvas_ordinals),
            (acceptance, manifest.acceptance_ordinals),
        ):
            session.add_all(
                AssetReferencePin(
                    owner_user_id=owner, reference_set_id=projection.id, asset_id=files[ordinal].id
                )
                for ordinal in ordinals
            )
