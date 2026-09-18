from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameAssetSettings,
    GalgameProjectAssetReference,
    GalgameStoryDocument,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.projects import project_out
from app.apps.galgame_workshop.schemas import (
    GalgameProjectSnapshotImportOut,
    GalgameStoryProject,
    GalgameWorkshopProjectCreateIn,
)
from app.apps.galgame_workshop.schemas.asr import GalgameTranscriptSegmentOut
from app.capabilities.asset_store import (
    AssetStorage,
    ExportedProjectSnapshot,
    IncomingFile,
    ProjectSnapshotError,
    SnapshotAssetSource,
    export_project_snapshot,
    move_staged_asset,
    stage_project_snapshot,
)
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from app.llm.models import (
    ModelEntry,
    ModelProvider,
)
from app.models import (
    VisualAsset,
)
from app.runtime.config import Settings
from app.runtime.ids import new_id
from app.schemas.project_snapshots import ProjectSnapshotImportWarning

VALID_CATEGORIES = {
    "character",
    "scene",
    "cg",
    "bgm",
    "ambient",
    "sfx",
    "voice",
    "video",
    "font",
    "other",
}
VALID_TRANSCRIPT_STATUS = {"pending", "queued", "running", "ready", "failed"}


def _copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def _story_file_ids(document: dict) -> set[str]:
    return {
        str(item["fileId"])
        for item in document.get("assets", [])
        if isinstance(item, dict) and item.get("fileId")
    }


def _fallback_category(asset: VisualAsset) -> str:
    return {
        "video": "video",
        "audio": "voice",
        "font": "font",
    }.get(asset.media_kind, "other")


def _asset_record(
    asset: VisualAsset, metadata: GalgameAssetMetadata | None, fallback_index: int
) -> dict:
    virtual_path = (
        metadata.virtual_path
        if metadata is not None and metadata.virtual_path
        else f"assets/imported-{fallback_index:04d}-{asset.original_filename}"
    )
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
        "category": metadata.category if metadata else _fallback_category(asset),
        "virtual_path": virtual_path,
        "packaging_policy": metadata.packaging_policy if metadata else "auto",
        "checksum_sha256": metadata.checksum_sha256 if metadata else None,
        "width": metadata.width if metadata else None,
        "height": metadata.height if metadata else None,
        "duration_ms": metadata.duration_ms if metadata else None,
        "transcript": metadata.transcript if metadata else None,
        "transcript_language": metadata.transcript_language if metadata else None,
        "transcript_status": metadata.transcript_status if metadata else "pending",
        "transcript_source": metadata.transcript_source if metadata else None,
        "transcript_revision": metadata.transcript_revision if metadata else 0,
        "transcript_segments": deepcopy(metadata.transcript_segments or []) if metadata else [],
    }


def _validated_assets(value: object, declared: set[str]) -> list[dict]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("Galgame 快照素材必须是数组")
    records: list[dict] = []
    ids: set[str] = set()
    virtual_paths: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("Galgame 快照包含无效素材记录")
        asset_id = str(item.get("id") or "")
        filename = Path(str(item.get("original_filename") or "")).name
        display_name = str(item.get("display_name") or "").strip()
        virtual_path = str(item.get("virtual_path") or "")
        path = PurePosixPath(virtual_path)
        byte_size = item.get("byte_size")
        transcript_revision = item.get("transcript_revision", 0)
        transcript_segments = item.get("transcript_segments", [])
        try:
            validated_segments = [
                GalgameTranscriptSegmentOut.model_validate(segment).model_dump(
                    mode="json", by_alias=True
                )
                for segment in transcript_segments
            ]
        except (TypeError, ValidationError) as exc:
            raise ProjectSnapshotError("Galgame 快照转写分段无效") from exc
        if (
            not asset_id
            or asset_id in ids
            or asset_id not in declared
            or not filename
            or not display_name
            or not isinstance(byte_size, int)
            or byte_size < 1
            or item.get("media_kind") not in {"image", "video", "audio", "font", "document"}
            or not str(item.get("mime_type") or "")
            or item.get("category") not in VALID_CATEGORIES
            or item.get("packaging_policy") not in {"auto", "include", "exclude"}
            or item.get("transcript_status") not in VALID_TRANSCRIPT_STATUS
            or item.get("transcript_source") not in {None, "asr", "manual"}
            or not isinstance(transcript_revision, int)
            or transcript_revision < 0
            or not isinstance(transcript_segments, list)
            or path.is_absolute()
            or ".." in path.parts
            or len(path.parts) < 2
            or virtual_path.casefold() in virtual_paths
        ):
            raise ProjectSnapshotError("Galgame 快照素材元数据无效")
        ids.add(asset_id)
        virtual_paths.add(virtual_path.casefold())
        records.append(
            dict(
                item,
                original_filename=filename,
                display_name=display_name,
                transcript_revision=transcript_revision,
                transcript_segments=validated_segments,
            )
        )
    if ids != declared:
        raise ProjectSnapshotError("Galgame 素材记录与快照清单不一致")
    return records


async def _model_reference(
    session: AsyncSession, model_id: str | None, workspace_id: str
) -> dict[str, str] | None:
    if not model_id:
        return None
    row = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(
                ModelEntry.id == model_id,
                ModelEntry.workspace_id == workspace_id,
                ModelProvider.workspace_id == workspace_id,
            )
        )
    ).first()
    if row is None:
        return None
    model, provider = row
    return {"provider_kind": provider.kind, "model_slug": model.slug}


async def _resolve_model(session: AsyncSession, reference: object, workspace_id: str) -> str | None:
    if not isinstance(reference, dict):
        return None
    rows = (
        (
            await session.execute(
                select(ModelEntry.id)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelProvider.kind == str(reference.get("provider_kind") or ""),
                    ModelEntry.slug == str(reference.get("model_slug") or ""),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.enabled.is_(True),
                    ModelEntry.workspace_id == workspace_id,
                    ModelProvider.workspace_id == workspace_id,
                )
            )
        )
        .scalars()
        .all()
    )
    return rows[0] if len(rows) == 1 else None


class GalgameProjectSnapshots:
    application_id = "galgame-workshop"

    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.settings = settings
        self.workspace_id = workspace_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(GalgameWorkshopProject).where(
                    GalgameWorkshopProject.id == project_id,
                    GalgameWorkshopProject.workspace_id == self.workspace_id,
                )
            )
        ).scalar_one_or_none()
        story = await self.session.get(GalgameStoryDocument, project_id) if project else None
        if project is None or story is None:
            raise ProjectSnapshotError("项目不存在", code="not_found", status=404)
        document = deepcopy(story.document or {})
        used_ids = _story_file_ids(document)
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
                        VisualAsset.workspace_id == self.workspace_id,
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
                    VisualAsset.workspace_id == self.workspace_id,
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
                _asset_record(asset, metadata.get(asset.id), index)
                for index, asset in enumerate(selected.values(), 1)
            ],
            "asset_settings": {
                "default_language": asset_settings.default_language if asset_settings else "auto",
                "concurrency": asset_settings.concurrency if asset_settings else 2,
                "model_reference": await _model_reference(
                    self.session,
                    asset_settings.asr_model_id if asset_settings else None,
                    self.workspace_id,
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
            payload = staged.project
            source_project = payload.get("project")
            if payload.get("schema_version") != 1 or not isinstance(source_project, dict):
                raise ProjectSnapshotError("project.json 不是受支持的 Galgame 快照")
            try:
                create = GalgameWorkshopProjectCreateIn.model_validate(source_project)
                story = GalgameStoryProject.model_validate(payload.get("story"))
            except ValidationError as exc:
                raise ProjectSnapshotError("Galgame Story 结构无效") from exc
            status = str(source_project.get("status") or "")
            if status not in {"draft", "completed"}:
                raise ProjectSnapshotError("Galgame 项目状态无效")
            declared = {item.source_id for item in staged.manifest.assets}
            assets = _validated_assets(payload.get("assets"), declared)
            asset_ids = {item["id"]: new_id() for item in assets}
            story_dump = story.model_dump(mode="json", by_alias=True)
            for item in story_dump.get("assets", []):
                source_file = item.get("fileId")
                if source_file not in asset_ids:
                    raise ProjectSnapshotError("Story 引用的素材未包含在项目快照中")
                item["fileId"] = asset_ids[source_file]
            raw_settings = payload.get("asset_settings")
            raw_settings = raw_settings if isinstance(raw_settings, dict) else {}
            model_reference = raw_settings.get("model_reference")
            model_id = await _resolve_model(self.session, model_reference, self.workspace_id)
            warnings: list[ProjectSnapshotImportWarning] = []
            if model_reference and not model_id:
                warnings.append(
                    ProjectSnapshotImportWarning(
                        code="model_binding_unavailable",
                        field="asset_settings.model_id",
                        message="原语音识别模型在当前 Workspace 中不可用，请重新选择。",
                    )
                )
            language = str(raw_settings.get("default_language") or "auto")
            concurrency = raw_settings.get("concurrency", 2)
            if (
                language not in {"auto", "zh", "ja"}
                or not isinstance(concurrency, int)
                or not 1 <= concurrency <= 8
            ):
                raise ProjectSnapshotError("Galgame ASR 设置无效")
            project = GalgameWorkshopProject(
                id=new_id(),
                workspace_id=self.workspace_id,
                title=_copy_title(create.title),
                status=status,
            )
            self.session.add(project)
            await self.session.flush()
            async with importing_project_layout(
                self.session,
                self.storage,
                self.application_id,
                project.id,
                workspace_id=self.workspace_id,
            ):
                for item in assets:
                    storage_key = uuid4().hex
                    new_asset_id = asset_ids[item["id"]]
                    self.session.add(
                        VisualAsset(
                            id=new_asset_id,
                            workspace_id=self.workspace_id,
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
                            workspace_id=self.workspace_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                for new_asset_id in _story_file_ids(story_dump):
                    self.session.add(
                        GalgameProjectAssetReference(project_id=project.id, asset_id=new_asset_id)
                    )
                self.session.add(GalgameStoryDocument(project_id=project.id, document=story_dump))
                self.session.add(
                    GalgameAssetSettings(
                        project_id=project.id,
                        asr_model_id=model_id,
                        default_language=language,
                        concurrency=concurrency,
                    )
                )
            await self.session.refresh(project)
            return GalgameProjectSnapshotImportOut(project=project_out(project), warnings=warnings)
        finally:
            staged.cleanup()
