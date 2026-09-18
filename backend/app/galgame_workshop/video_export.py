from __future__ import annotations

import asyncio
import hashlib
import json
import shutil
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store import AssetError
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.frame_renderer import render_plan_frame
from app.galgame_workshop.story import GalgameStoryDocuments
from app.galgame_workshop.video_compiler import COMPILER_VERSION, compile_galgame_render_plan
from app.galgame_workshop.video_dialogue import dialogue_renderer_issue
from app.galgame_workshop.video_export_planning import (
    EXPORT_PACKAGING_POLICY,
    PRESETS,
    _plan_clip,
    _plan_fragments,
    _plan_route,
)
from app.galgame_workshop.video_lip_sync import prepare_audio_envelopes
from app.models import (
    GalgameAssetMetadata,
    GalgameStorySnapshot,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
    VisualAsset,
)
from app.runtime.config import Settings, get_settings
from app.runtime.time import iso_utc, utc_now
from app.schemas.galgame_workshop import (
    GalgameVideoExportChoiceOut,
    GalgameVideoExportCreateIn,
    GalgameVideoExportDecisionOut,
    GalgameVideoExportFrameIn,
    GalgameVideoExportIssue,
    GalgameVideoExportPreviewIn,
    GalgameVideoExportPreviewOut,
    GalgameVideoExportRouteOut,
    GalgameVideoExportTaskListOut,
    GalgameVideoExportTaskOut,
)

__all__ = ["EXPORT_PACKAGING_POLICY", "GalgameVideoExports"]


def _task_out(row: GalgameVideoExportTask) -> GalgameVideoExportTaskOut:
    result = dict(row.result_detail or {})
    phase = result.get("phase")
    if phase not in {
        "queued",
        "preparing",
        "analyzing",
        "rendering",
        "encoding",
        "verifying",
        "registering",
        "completed",
        "failed",
        "cancelled",
    }:
        phase = "rendering" if row.status == "running" else row.status
    return GalgameVideoExportTaskOut(
        id=row.id,
        projectId=row.project_id,
        requestId=row.request_id,
        storyRevision=row.story_revision,
        status=row.status,
        phase=phase,
        progress=row.progress,
        renderedMs=max(0, int(result.get("renderedMs", 0))),
        totalMs=max(0, int(result.get("totalMs", 0))),
        preset=row.request_payload.get("preset", "1080p30"),
        endingLabel=str(result.get("endingLabel", "")),
        outputAssetId=row.output_asset_id,
        outputFilename=result.get("outputFilename"),
        cancelRequested=row.cancel_requested,
        error=row.error,
        revision=row.revision,
        createdAt=iso_utc(row.created_at),
        updatedAt=iso_utc(row.updated_at),
        startedAt=iso_utc(row.started_at) if row.started_at else None,
        finishedAt=iso_utc(row.finished_at) if row.finished_at else None,
    )


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
        blockers: list[GalgameVideoExportIssue] = []
        warnings: list[GalgameVideoExportIssue] = []
        if story.revision != body.expected_story_revision:
            blockers.append(
                GalgameVideoExportIssue(
                    code="story_revision_conflict",
                    message=f"Story 已更新到 revision {story.revision}，请刷新后重新预览",
                    path="/expectedStoryRevision",
                )
            )
        document = story.document.model_dump(mode="json", by_alias=True)
        asset_duration: dict[str, int] = {}
        assets_by_file: dict[str, VisualAsset] = {}
        file_ids = [item.get("fileId") for item in document.get("assets", []) if item.get("fileId")]
        if file_ids:
            rows = list(
                (
                    await self.session.execute(
                        select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                    )
                ).scalars()
            )
            assets_by_file = {item.id: item for item in rows}
            metadata_rows = list(
                (
                    await self.session.execute(
                        select(GalgameAssetMetadata).where(
                            GalgameAssetMetadata.asset_id.in_(file_ids)
                        )
                    )
                ).scalars()
            )
            metadata_by_file = {item.asset_id: item for item in metadata_rows}
            for story_asset in document.get("assets", []):
                file_id = story_asset.get("fileId")
                metadata = metadata_by_file.get(file_id)
                if metadata and metadata.duration_ms is not None:
                    asset_duration[story_asset["id"]] = metadata.duration_ms
        for index, story_asset in enumerate(document.get("assets", [])):
            file_id = story_asset.get("fileId")
            asset = assets_by_file.get(file_id)
            if asset is None or not self.storage.path_for(asset).is_file():
                blockers.append(
                    GalgameVideoExportIssue(
                        code="missing_asset",
                        message=f"素材“{story_asset.get('label') or story_asset.get('id')}”不可用",
                        path=f"/assets/{index}",
                    )
                )
        for program in ("ffmpeg", "ffprobe"):
            if shutil.which(program) is None:
                blockers.append(
                    GalgameVideoExportIssue(
                        code="renderer_dependency_missing",
                        message=f"视频导出缺少运行程序：{program}",
                        path="/renderer",
                    )
                )
        font_issue = dialogue_renderer_issue()
        if font_issue:
            blockers.append(
                GalgameVideoExportIssue(
                    code="renderer_font_missing",
                    message=font_issue,
                    path="/renderer/fonts",
                )
            )
        selections = {item.branch_block_id: item.choice_id for item in body.branch_selections}
        if body.scope == "fragments":
            plan = _plan_fragments(document, body.fragment_ids, asset_duration)
        elif body.scope == "clip" and body.clip_range is not None:
            plan = _plan_clip(
                document,
                body.clip_range.fragment_id,
                body.clip_range.start_ms,
                body.clip_range.end_ms,
            )
        else:
            plan = _plan_route(document, selections, asset_duration)
            if plan.fragment_ids and not plan.fragment_durations_ms:
                fragment_plan = _plan_fragments(document, plan.fragment_ids, asset_duration)
                plan.fragment_durations_ms = fragment_plan.fragment_durations_ms
                if plan.fragment_durations_ms:
                    remainder = plan.duration_ms - sum(plan.fragment_durations_ms)
                    plan.fragment_durations_ms[-1] += max(0, remainder)
        blockers.extend(plan.blockers)
        warnings.extend(plan.warnings)
        bitrate_mbps = 6 if body.preset == "720p30" else (18 if body.preset == "1080p60" else 10)
        estimated_work_bytes = max(
            2 * 1024 * 1024 * 1024,
            round(plan.duration_ms / 1000 * bitrate_mbps * 1_000_000 / 8 * 3),
        )
        try:
            free_bytes = shutil.disk_usage(self.settings.runtime_path).free
        except OSError:
            free_bytes = 0
        if free_bytes < estimated_work_bytes:
            blockers.append(
                GalgameVideoExportIssue(
                    code="insufficient_disk_space",
                    message="可用磁盘空间不足以安全完成本次视频导出",
                    path="/renderer/disk",
                )
            )
        decision = None
        if plan.decision is not None:
            decision = GalgameVideoExportDecisionOut(
                branchBlockId=plan.decision["id"],
                prompt=plan.decision.get("prompt", ""),
                choices=[
                    GalgameVideoExportChoiceOut(
                        id=item["id"],
                        text=item.get("text", ""),
                        targetFragmentId=item["targetFragmentId"],
                    )
                    for item in plan.decision.get("choices", [])
                ],
            )
        width, height, fps = PRESETS[body.preset]
        route = GalgameVideoExportRouteOut(
            chapterIds=plan.chapter_ids,
            fragmentIds=plan.fragment_ids,
            fragmentDurationsMs=plan.fragment_durations_ms,
            branchBlockIds=plan.branch_block_ids,
            endingLabel=plan.ending_label,
            estimatedDurationMs=plan.duration_ms,
            exactDuration=plan.exact_duration,
        )
        fingerprint_payload = {
            "compilerVersion": COMPILER_VERSION,
            "storyRevision": story.revision,
            "locale": body.locale,
            "preset": body.preset,
            "scope": body.scope,
            "fragmentIds": body.fragment_ids,
            "clipRange": (
                body.clip_range.model_dump(mode="json", by_alias=True)
                if body.clip_range is not None
                else None
            ),
            "branchSelections": [
                item.model_dump(mode="json", by_alias=True) for item in body.branch_selections
            ],
            "captureFrame": body.capture_frame.model_dump(mode="json", by_alias=True),
            "route": route.model_dump(mode="json", by_alias=True),
            "decision": decision.model_dump(mode="json", by_alias=True) if decision else None,
            "assets": [
                {
                    "id": asset.id,
                    "revision": asset.revision,
                    "bytes": asset.byte_size,
                    "updatedAt": asset.updated_at.isoformat(),
                }
                for asset in sorted(assets_by_file.values(), key=lambda item: item.id)
            ],
        }
        fingerprint = hashlib.sha256(
            json.dumps(fingerprint_payload, ensure_ascii=False, sort_keys=True).encode()
        ).hexdigest()
        return GalgameVideoExportPreviewOut(
            ready=not blockers and decision is None,
            storyRevision=story.revision,
            preset=body.preset,
            width=width,
            height=height,
            fps=fps,
            previewFingerprint=fingerprint,
            route=route,
            nextDecision=decision,
            blockers=blockers,
            warnings=warnings,
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
                    "galgame-workshop", project_id, workspace_id=project.workspace_id
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
