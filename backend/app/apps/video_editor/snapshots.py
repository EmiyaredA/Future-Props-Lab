from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.video_editor.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
    VideoEditorTimeline,
)
from app.apps.video_editor.projects import project_out
from app.apps.video_editor.schemas import (
    VideoEditorProjectCreateIn,
    VideoEditorProjectSnapshotImportOut,
    parse_timeline_document,
)
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
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.project_transactions import importing_project_layout
from app.capabilities.asset_store.storage import TARGET_STORAGE_VERSION
from app.runtime.config import Settings
from app.runtime.ids import new_id


def _copy_title(title: str) -> str:
    suffix = "（副本）"
    return f"{title[: 120 - len(suffix)]}{suffix}"


def _timeline_asset_ids(document: dict) -> set[str]:
    ids = {
        str(clip[key])
        for track in document.get("tracks", [])
        if isinstance(track, dict)
        for clip in track.get("clips", [])
        if isinstance(clip, dict)
        for key in ("assetId", "fontAssetId")
        if clip.get(key)
    }
    organization = document.get("assetOrganization") or {}
    ids.update(str(asset_id) for asset_id in organization.get("rootAssetIds") or [])
    for folder in organization.get("folders") or []:
        ids.update(str(asset_id) for asset_id in folder.get("assetIds") or [])
    return ids


def _asset_record(asset: VisualAsset) -> dict:
    return {
        "id": asset.id,
        "original_filename": asset.original_filename,
        "display_name": asset.display_name,
        "media_kind": asset.media_kind,
        "mime_type": asset.mime_type,
        "byte_size": asset.byte_size,
    }


def _validated_assets(value: object, declared: set[str]) -> list[dict]:
    if not isinstance(value, list):
        raise ProjectSnapshotError("视频剪辑快照素材必须是数组")
    records: list[dict] = []
    ids: set[str] = set()
    for item in value:
        if not isinstance(item, dict):
            raise ProjectSnapshotError("视频剪辑快照包含无效素材记录")
        asset_id = str(item.get("id") or "")
        filename = Path(str(item.get("original_filename") or "")).name
        display_name = str(item.get("display_name") or "").strip()
        byte_size = item.get("byte_size")
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
        ):
            raise ProjectSnapshotError("视频剪辑快照素材元数据无效")
        ids.add(asset_id)
        records.append(dict(item, original_filename=filename, display_name=display_name))
    if ids != declared:
        raise ProjectSnapshotError("视频剪辑素材记录与快照清单不一致")
    return records


def _optional_string(value: object, *, max_length: int) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str) or len(value) > max_length:
        raise ProjectSnapshotError("视频剪辑项目来源信息无效")
    return value


def _optional_revision(value: object) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int) or value < 0:
        raise ProjectSnapshotError("视频剪辑项目来源信息无效")
    return value


class VideoEditorProjectSnapshots:
    application_id = "video-editor"

    def __init__(self, session: AsyncSession, settings: Settings, workspace_id: str) -> None:
        self.session = session
        self.settings = settings
        self.workspace_id = workspace_id
        self.storage = AssetStorage(settings)

    async def export(self, project_id: str) -> ExportedProjectSnapshot:
        project = (
            await self.session.execute(
                select(VideoEditorProject).where(
                    VideoEditorProject.id == project_id,
                    VideoEditorProject.workspace_id == self.workspace_id,
                )
            )
        ).scalar_one_or_none()
        timeline = await self.session.get(VideoEditorTimeline, project_id) if project else None
        if project is None or timeline is None:
            raise ProjectSnapshotError("剪辑项目不存在", code="not_found", status=404)
        document = deepcopy(timeline.document or {})
        used_ids = _timeline_asset_ids(document)
        output_ids = set(
            (
                await self.session.execute(
                    select(VideoEditorTask.output_asset_id).where(
                        VideoEditorTask.project_id == project_id,
                        VideoEditorTask.output_asset_id.is_not(None),
                        VideoEditorTask.kind.in_(("render", "segment_export", "asset_bake")),
                    )
                )
            ).scalars()
        )
        segment_details = await self.session.scalars(
            select(VideoEditorTask.result_detail).where(
                VideoEditorTask.project_id == project_id,
                VideoEditorTask.workspace_id == self.workspace_id,
                VideoEditorTask.kind == "segment_export",
                VideoEditorTask.status == "completed",
            )
        )
        output_ids.update(
            item["assetId"]
            for detail in segment_details
            for item in (detail or {}).get("segments", [])
            if item.get("status") == "completed" and item.get("assetId")
        )
        all_assets = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.video_editor_project_id == project_id,
                        VisualAsset.workspace_id == self.workspace_id,
                    )
                )
            ).scalars()
        )
        selected = [
            asset for asset in all_assets if asset.id not in output_ids or asset.id in used_ids
        ]
        payload = {
            "schema_version": 1,
            "project": {
                "title": project.title,
                "status": project.status,
                "source_application": project.source_application,
                "source_project_id": project.source_project_id,
                "source_revision": project.source_revision,
                "source_compiler_version": project.source_compiler_version,
            },
            "timeline": document,
            "assets": [_asset_record(asset) for asset in selected],
        }
        title = project.title
        source_project = project_out(project).model_dump(mode="json", by_alias=True)
        sources = [
            SnapshotAssetSource(asset.id, self.storage.path_for(asset)) for asset in selected
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

    async def import_snapshot(self, upload: IncomingFile) -> VideoEditorProjectSnapshotImportOut:
        staged = await stage_project_snapshot(
            self.settings, upload, expected_application=self.application_id
        )
        try:
            payload = staged.project
            source_project = payload.get("project")
            if payload.get("schema_version") != 1 or not isinstance(source_project, dict):
                raise ProjectSnapshotError("project.json 不是受支持的视频剪辑快照")
            try:
                create = VideoEditorProjectCreateIn.model_validate(source_project)
                timeline = parse_timeline_document(payload.get("timeline"))
            except ValidationError as exc:
                raise ProjectSnapshotError("视频剪辑时间线结构无效") from exc
            status = str(source_project.get("status") or "")
            if status not in {"draft", "completed"}:
                raise ProjectSnapshotError("视频剪辑项目状态无效")
            declared = {item.source_id for item in staged.manifest.assets}
            assets = _validated_assets(payload.get("assets"), declared)
            asset_ids = {item["id"]: new_id() for item in assets}
            timeline_dump = timeline.model_dump(mode="json", by_alias=True)
            for track in timeline_dump.get("tracks", []):
                for clip in track.get("clips", []):
                    for key in ("assetId", "fontAssetId"):
                        if clip.get(key):
                            if clip[key] not in asset_ids:
                                raise ProjectSnapshotError("时间线引用的素材未包含在项目快照中")
                            clip[key] = asset_ids[clip[key]]
            organization = timeline_dump.get("assetOrganization") or {}
            for key in ("rootAssetIds",):
                for index, asset_id in enumerate(organization.get(key) or []):
                    if asset_id not in asset_ids:
                        raise ProjectSnapshotError("素材编排引用的素材未包含在项目快照中")
                    organization[key][index] = asset_ids[asset_id]
            for folder in organization.get("folders") or []:
                for index, asset_id in enumerate(folder.get("assetIds") or []):
                    if asset_id not in asset_ids:
                        raise ProjectSnapshotError("素材编排引用的素材未包含在项目快照中")
                    folder["assetIds"][index] = asset_ids[asset_id]
            project = VideoEditorProject(
                id=new_id(),
                workspace_id=self.workspace_id,
                title=_copy_title(create.title),
                status=status,
                source_application=_optional_string(
                    source_project.get("source_application"), max_length=32
                ),
                source_project_id=_optional_string(
                    source_project.get("source_project_id"), max_length=36
                ),
                source_revision=_optional_revision(source_project.get("source_revision")),
                source_compiler_version=_optional_string(
                    source_project.get("source_compiler_version"), max_length=64
                ),
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
                            video_editor_project_id=project.id,
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
                        VideoEditorAssetMetadata(asset_id=new_asset_id, project_id=project.id)
                    )
                    self.session.add(
                        VideoEditorTask(
                            workspace_id=self.workspace_id,
                            project_id=project.id,
                            request_id=f"media-{new_asset_id}",
                            kind="media",
                            status="queued",
                            request_payload={"assetId": new_asset_id},
                        )
                    )
                    move_staged_asset(
                        staged.asset_path(item["id"]),
                        self.storage.target_path(
                            storage_key,
                            visual_project_id=None,
                            galgame_project_id=None,
                            video_editor_project_id=project.id,
                            workspace_id=self.workspace_id,
                        ),
                        expected_size=item["byte_size"],
                    )
                self.session.add(VideoEditorTimeline(project_id=project.id, document=timeline_dump))
            await self.session.refresh(project)
            return VideoEditorProjectSnapshotImportOut(project=project_out(project), warnings=[])
        finally:
            staged.cleanup()
