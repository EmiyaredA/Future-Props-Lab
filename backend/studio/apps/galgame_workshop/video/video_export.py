from __future__ import annotations

import asyncio
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.capabilities.media_rendering.galgame.compiler import (
    COMPILER_VERSION,
    compile_galgame_render_plan,
)
from app.capabilities.media_rendering.galgame.lip_sync import prepare_audio_envelopes
from app.capabilities.media_rendering.render_capacity import galgame_capacity
from studio.apps.galgame_workshop.schemas import (
    GalgameVideoExportCreateIn,
    GalgameVideoExportFrameIn,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)
from studio.apps.galgame_workshop.storage.models import (
    GalgameAssetMetadata,
    GalgameStorySnapshot,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from studio.apps.galgame_workshop.story.story import GalgameStoryDocuments
from studio.apps.galgame_workshop.task_views import export_task_out as _task_out
from studio.apps.galgame_workshop.video.export_preview import preview_export
from studio.apps.galgame_workshop.video.video_export_planning import EXPORT_PACKAGING_POLICY
from studio.config.settings import Settings, get_settings
from studio.runtime.time import utc_now

__all__ = ["EXPORT_PACKAGING_POLICY", "GalgameVideoExports"]


class GalgameVideoExports:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def _project(self, project_id: str) -> GalgameWorkshopProject:
        project = await self.session.get(GalgameWorkshopProject, project_id)
        if project is None:
            raise AssetError("Galgame 项目不存在", code="not_found", status=404)
        return project

    async def preview(
        self, project_id: str, body: GalgameVideoExportPreviewIn
    ) -> GalgameVideoExportPreviewOut:
        await self._project(project_id)
        story = await GalgameStoryDocuments(self.session).get(project_id)
        file_ids = {asset.file_id for asset in story.document.assets}
        rows = list(
            await self.session.scalars(select(VisualAsset).where(VisualAsset.id.in_(file_ids)))
        )
        metadata = await self.session.scalars(
            select(GalgameAssetMetadata).where(GalgameAssetMetadata.asset_id.in_(file_ids))
        )
        return preview_export(
            story,
            body,
            assets_by_file={asset.id: asset for asset in rows},
            available={asset.id for asset in rows if self.storage.path_for(asset).is_file()},
            durations_by_file={
                row.asset_id: row.duration_ms for row in metadata if row.duration_ms is not None
            },
            capacity=galgame_capacity(self.settings.runtime_path),
        )

    async def create(
        self, project_id: str, body: GalgameVideoExportCreateIn
    ) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        payload = body.model_dump(mode="json", by_alias=True)
        existing = await self.session.scalar(
            select(GalgameVideoExportTask).where(
                GalgameVideoExportTask.project_id == project_id,
                GalgameVideoExportTask.request_id == body.request_id,
            )
        )
        if existing is not None:
            if any(existing.request_payload.get(key) != value for key, value in payload.items()):
                raise AssetError(
                    "同一 requestId 已用于不同导出请求",
                    code="idempotency_conflict",
                    status=409,
                )
            return _task_out(existing)
        preview_body = GalgameVideoExportPreviewIn.model_validate(
            body.model_dump(mode="json", by_alias=True)
        )
        preview = await self.preview(project_id, preview_body)
        if preview.preview_fingerprint != body.preview_fingerprint:
            raise AssetError(
                "导出预览已失效，请重新预览路线",
                code="preview_conflict",
                status=409,
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        if not preview.ready:
            raise AssetError(
                "视频导出预览未通过",
                code="video_export_not_ready",
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        payload["resolvedFragmentIds"] = preview.route.fragment_ids
        payload["compilerVersion"] = COMPILER_VERSION
        story = await GalgameStoryDocuments(self.session).get(project_id)
        snapshot = GalgameStorySnapshot(
            project_id=project_id,
            story_revision=story.revision,
            reason="video-export",
            document=story.document.model_dump(mode="json", by_alias=True),
        )
        self.session.add(snapshot)
        await self.session.flush()
        task = GalgameVideoExportTask(
            owner_user_id=(await self._project(project_id)).owner_user_id,
            project_id=project_id,
            snapshot_id=snapshot.id,
            request_id=body.request_id,
            story_revision=story.revision,
            request_payload=payload,
            result_detail={
                "phase": "queued",
                "renderedMs": 0,
                "totalMs": preview.route.estimated_duration_ms,
                "endingLabel": preview.route.ending_label,
                "fragmentDurationsMs": preview.route.fragment_durations_ms,
            },
        )
        self.session.add(task)
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def frame(self, project_id: str, body: GalgameVideoExportFrameIn) -> bytes:
        project = await self._project(project_id)
        preview_body = GalgameVideoExportPreviewIn.model_validate(
            body.model_dump(mode="json", by_alias=True)
        )
        preview = await self.preview(project_id, preview_body)
        if not preview.ready:
            raise AssetError(
                "精确帧预览未通过导出检查",
                code="video_export_not_ready",
                detail={"preview": preview.model_dump(mode="json", by_alias=True)},
            )
        if body.time_ms > preview.route.estimated_duration_ms:
            raise AssetError("预览时间超出导出范围", code="invalid_time", status=422)
        story = await GalgameStoryDocuments(self.session).get(project_id)
        document = story.document.model_dump(mode="json", by_alias=True)
        file_ids = [item.get("fileId") for item in document.get("assets", []) if item.get("fileId")]
        assets = (
            list(
                (
                    await self.session.execute(
                        select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                    )
                ).scalars()
            )
            if file_ids
            else []
        )
        asset_paths = {asset.id: self.storage.path_for(asset) for asset in assets}
        asset_fingerprints = {
            asset.id: (f"{asset.id}:{asset.revision}:{asset.storage_version}:{asset.byte_size}")
            for asset in assets
        }
        metadata_rows = (
            list(
                (
                    await self.session.execute(
                        select(GalgameAssetMetadata).where(
                            GalgameAssetMetadata.asset_id.in_(file_ids)
                        )
                    )
                ).scalars()
            )
            if file_ids
            else []
        )
        duration_by_file = {
            item.asset_id: item.duration_ms
            for item in metadata_rows
            if item.duration_ms is not None
        }
        asset_duration_ms = {
            str(item["id"]): duration_by_file[item["fileId"]]
            for item in document.get("assets", [])
            if item.get("fileId") in duration_by_file
        }
        payload = body.model_dump(mode="json", by_alias=True, exclude={"time_ms", "width"})
        payload["resolvedFragmentIds"] = preview.route.fragment_ids
        try:
            envelopes = await asyncio.to_thread(
                prepare_audio_envelopes,
                document,
                asset_paths,
                cache_dir=self.storage.project_root(
                    "galgame-workshop", project_id, owner_user_id=project.owner_user_id
                )
                / "derived"
                / "audio-envelopes",
                asset_fingerprints=asset_fingerprints,
                selected_fragment_ids=set(preview.route.fragment_ids),
            )
            compiled = await asyncio.to_thread(
                compile_galgame_render_plan,
                document,
                payload,
                fragment_durations_ms=preview.route.fragment_durations_ms,
                total_ms=preview.route.estimated_duration_ms,
                asset_paths=asset_paths,
                asset_duration_ms=asset_duration_ms,
                audio_envelopes=envelopes,
            )
        except (RuntimeError, ValueError) as exc:
            raise AssetError(
                f"无法准备确定性口型与动画：{exc}",
                code="video_export_compilation_failed",
                status=422,
            ) from exc
        return await asyncio.to_thread(
            render_plan_frame,
            compiled.plan,
            time_us=body.time_ms * 1000,
            width=body.width,
        )

    async def list(self, project_id: str) -> GalgameVideoExportTaskListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(GalgameVideoExportTask)
                    .where(GalgameVideoExportTask.project_id == project_id)
                    .order_by(GalgameVideoExportTask.created_at.desc())
                    .limit(50)
                )
            ).scalars()
        )
        return GalgameVideoExportTaskListOut(items=[_task_out(row) for row in rows])

    async def get(self, project_id: str, export_id: str) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id:
            raise AssetError("视频导出任务不存在", code="not_found", status=404)
        return _task_out(task)

    async def cancel(self, project_id: str, export_id: str) -> GalgameVideoExportTaskOut:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id:
            raise AssetError("视频导出任务不存在", code="not_found", status=404)
        if task.status in {"completed", "failed", "cancelled"}:
            return _task_out(task)
        task.cancel_requested = True
        task.revision += 1
        task.updated_at = utc_now()
        if task.status == "queued":
            task.status = "cancelled"
            task.progress = 0
            task.result_detail = {**(task.result_detail or {}), "phase": "cancelled"}
            task.finished_at = utc_now()
        await self.session.commit()
        await self.session.refresh(task)
        return _task_out(task)

    async def output(self, project_id: str, export_id: str) -> tuple[VisualAsset, Path]:
        await self._project(project_id)
        task = await self.session.get(GalgameVideoExportTask, export_id)
        if task is None or task.project_id != project_id or task.output_asset_id is None:
            raise AssetError("导出视频尚不可下载", code="not_found", status=404)
        asset = await self.session.get(VisualAsset, task.output_asset_id)
        if asset is None:
            raise AssetError("导出视频已被删除", code="not_found", status=404)
        path = self.storage.path_for(asset)
        if not path.is_file():
            raise AssetError("导出视频文件不存在", code="not_found", status=404)
        return asset, path
