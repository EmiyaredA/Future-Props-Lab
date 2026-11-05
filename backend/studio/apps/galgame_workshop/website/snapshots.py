from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import (
    AssetStorage,
    ExportedProjectSnapshot,
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
    move_staged_asset,
    stage_project_snapshot,
)
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from studio.apps.galgame_workshop.schemas import GalgameProjectSnapshotImportOut
from studio.apps.galgame_workshop.snapshot_values import (
    snapshot_asset_record,
    story_file_ids,
    validate_snapshot,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.website.projects import project_out
from studio.apps.model_service.catalog.transcription import (
    resolve_transcription_model_reference,
    transcription_model_reference,
)
from studio.config.settings import Settings
from studio.contracts.asset_library.incoming import IncomingFile
from studio.runtime.ids import new_id


class GalgameProjectSnapshots:
    application_id = "galgame-workshop"

    def __init__(self, session: AsyncSession, settings: Settings, owner_user_id: str) -> None:
        self.session = session
        self.settings = settings
        self.owner_user_id = owner_user_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(GalgameWorkshopProject).where(
                    GalgameWorkshopProject.id == project_id,
                    GalgameWorkshopProject.owner_user_id == self.owner_user_id,
                )
            )
        ).scalar_one_or_none()
        story = await self.session.get(GalgameStoryDocument, project_id) if project else None
        if project is None or story is None:
            raise ProjectSnapshotError("项目不存在", code="not_found", status=404)
        document = deepcopy(story.document or {})
        used_ids = story_file_ids(document)
        output_ids = set(
            (
                await self.session.execute(
                    select(GalgameVideoExportTask.output_asset_id).where(
                        GalgameVideoExportTask.project_id == project_id,
                        GalgameVideoExportTask.output_asset_id.is_not(None),
                    )
                )
            ).scalars()
        )
        private = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.galgame_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        referenced = (
            await self.session.execute(
                select(GalgameProjectAssetReference, VisualAsset)
                .join(VisualAsset, VisualAsset.id == GalgameProjectAssetReference.asset_id)
                .where(
                    GalgameProjectAssetReference.project_id == project_id,
                    VisualAsset.owner_user_id == self.owner_user_id,
                )
            )
        ).all()
        selected: dict[str, VisualAsset] = {
            asset.id: asset
            for asset in private
            if asset.id not in output_ids or asset.id in used_ids
        }
        selected.update(
            {asset.id: asset for _reference, asset in referenced if asset.id in used_ids}
        )
        metadata_rows = (
            list(
                (
                    await self.session.execute(
                        select(GalgameAssetMetadata).where(
                            GalgameAssetMetadata.asset_id.in_(selected.keys())
                        )
                    )
                ).scalars()
            )
            if selected
            else []
        )
        metadata = {row.asset_id: row for row in metadata_rows}
        asset_settings = await self.session.get(GalgameAssetSettings, project_id)
        payload = {
            "schema_version": 1,
            "project": {"title": project.title, "status": project.status},
            "story": document,
            "assets": [
                snapshot_asset_record(asset, metadata.get(asset.id), index)
                for index, asset in enumerate(selected.values(), 1)
            ],
            "asset_settings": {
                "default_language": asset_settings.default_language if asset_settings else "auto",
                "concurrency": asset_settings.concurrency if asset_settings else 2,
                "model_reference": await transcription_model_reference(
                    self.session,
                    asset_settings.asr_model_id if asset_settings else None,
                    self.owner_user_id,
                ),
            },
        }
        title = project.title
        source_project = project_out(project).model_dump(mode="json")
        sources = [
            SnapshotAssetSource(asset.id, self.storage.path_for(asset))
            for asset in selected.values()
        ]
        await self.session.rollback()
        return await export_project_snapshot(
            self.settings,
            application_id=self.application_id,
            title=title,
            source_project=source_project,
            project=payload,
            assets=sources,
        )

    async def import_snapshot(self, upload: IncomingFile) -> GalgameProjectSnapshotImportOut:
        staged = await stage_project_snapshot(
            self.settings, upload, expected_application=self.application_id
        )
        try:
            values = validate_snapshot(staged)
            assets = values.assets
            asset_ids = {item["id"]: new_id() for item in assets}
            story_dump = values.with_files(asset_ids)
            model_id = await resolve_transcription_model_reference(
                self.session, values.model_reference, self.owner_user_id
            )
            project = GalgameWorkshopProject(
                id=new_id(),
                owner_user_id=self.owner_user_id,
                title=values.title,
                status=values.status,
            )
            self.session.add(project)
            await self.session.flush()
            async with importing_project_layout(
                self.session,
                self.storage,
                self.application_id,
                project.id,
                owner_user_id=self.owner_user_id,
            ):
                for item in assets:
                    storage_key = uuid4().hex
                    new_asset_id = asset_ids[item["id"]]
                    self.session.add(
                        VisualAsset(
                            id=new_asset_id,
                            owner_user_id=self.owner_user_id,
                            galgame_project_id=project.id,
                            original_filename=item["original_filename"],
                            display_name=item["display_name"],
                            storage_key=storage_key,
                            storage_version=TARGET_STORAGE_VERSION,
                            media_kind=item["media_kind"],
                            mime_type=item["mime_type"],
                            byte_size=item["byte_size"],
                        )
                    )
                    await self.session.flush()
                    self.session.add(
                        GalgameAssetMetadata(
                            asset_id=new_asset_id,
                            project_id=project.id,
                            category=item["category"],
                            virtual_path=item["virtual_path"],
                            packaging_policy=item["packaging_policy"],
                            checksum_sha256=item.get("checksum_sha256"),
                            width=item.get("width"),
                            height=item.get("height"),
                            duration_ms=item.get("duration_ms"),
                            transcript=item.get("transcript"),
                            transcript_language=item.get("transcript_language"),
                            transcript_status=item["transcript_status"],
                            transcript_source=item.get("transcript_source"),
                            transcript_revision=item["transcript_revision"],
                            transcript_segments=deepcopy(item["transcript_segments"]),
                        )
                    )
                    move_staged_asset(
                        staged.asset_path(item["id"]),
                        self.storage.target_path(
                            storage_key,
                            visual_project_id=None,
                            galgame_project_id=project.id,
                            owner_user_id=self.owner_user_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                for new_asset_id in story_file_ids(story_dump):
                    self.session.add(
                        GalgameProjectAssetReference(project_id=project.id, asset_id=new_asset_id)
                    )
                self.session.add(GalgameStoryDocument(project_id=project.id, document=story_dump))
                self.session.add(
                    GalgameAssetSettings(
                        project_id=project.id,
                        asr_model_id=model_id,
                        default_language=values.language,
                        concurrency=values.concurrency,
                    )
                )
            await self.session.refresh(project)
            return GalgameProjectSnapshotImportOut(
                project=project_out(project), warnings=values.model_warnings(model_id)
            )
        finally:
            staged.cleanup()
