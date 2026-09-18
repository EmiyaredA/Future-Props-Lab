from __future__ import annotations

import asyncio
import json
import re
import subprocess
import threading
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.apps.galgame_workshop.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStorySnapshot,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
)
from app.apps.galgame_workshop.video.video_compiler import compile_galgame_render_plan
from app.apps.galgame_workshop.video.video_export_planning import (
    EXPORT_PACKAGING_POLICY,
    PRESETS,
)
from app.apps.galgame_workshop.video.video_lip_sync import prepare_audio_envelopes
from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.render_engine import RenderCancelled, render_plan
from app.models import (
    VisualAsset,
)
from app.orm import bind_workspace, require_workspace_id
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value).strip(" .-")
    return (cleaned or "galgame-export")[:180]


def _probe_video(path: Path) -> dict[str, Any]:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration:stream=codec_type,codec_name,width,height,avg_frame_rate,pix_fmt",
            "-of",
            "json",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def _recover_interrupted_task(row: GalgameVideoExportTask) -> None:
    if row.cancel_requested:
        row.status = "cancelled"
        row.progress = 0
        row.result_detail = {**(row.result_detail or {}), "phase": "cancelled"}
        row.finished_at = utc_now()
    else:
        row.status = "queued"
        row.error = None
        row.result_detail = {**(row.result_detail or {}), "phase": "queued"}
    row.revision += 1
    row.updated_at = utc_now()


class GalgameVideoExportRunner(PollingTaskRunner):
    runner_name = "galgame-video-export-runner"
    poll_interval_seconds = 1.0

    def __init__(
        self,
        session_factory: async_sessionmaker[AsyncSession] = SessionLocal,
        settings: Settings | None = None,
    ) -> None:
        super().__init__()
        self.session_factory = session_factory
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

    async def recover(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(GalgameVideoExportTask).where(
                            GalgameVideoExportTask.status == "running"
                        )
                    )
                ).scalars()
            )
            for row in rows:
                _recover_interrupted_task(row)
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(GalgameVideoExportTask.id)
                .where(GalgameVideoExportTask.status == "queued")
                .order_by(GalgameVideoExportTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        phase: str | None = None,
        progress: int | None = None,
        rendered_ms: int | None = None,
        error: str | None = None,
        output_asset_id: str | None = None,
        output_filename: str | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            task = await session.get(GalgameVideoExportTask, task_id)
            if task is None:
                return
            bind_workspace(
                session,
                require_workspace_id(task.workspace_id, subject="video export task"),
            )
            detail = dict(task.result_detail or {})
            if phase is not None:
                detail["phase"] = phase
            if rendered_ms is not None:
                detail["renderedMs"] = max(0, rendered_ms)
            if output_filename is not None:
                detail["outputFilename"] = output_filename
            task.result_detail = detail
            if status is not None:
                task.status = status
            if progress is not None:
                task.progress = max(0, min(100, progress))
            if output_asset_id is not None:
                task.output_asset_id = output_asset_id
            task.error = error
            task.revision += 1
            task.updated_at = utc_now()
            if finished:
                task.finished_at = utc_now()
            await session.commit()

    async def _cancel_requested(self, task_id: str) -> bool:
        async with self.session_factory() as session:
            task = await session.get(GalgameVideoExportTask, task_id)
            return task is None or task.cancel_requested

    async def _raise_if_cancelled(self, task_id: str) -> None:
        if await self._cancel_requested(task_id):
            raise InterruptedError("视频导出已取消")

    async def _process(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await session.get(GalgameVideoExportTask, task_id)
                if task is None or task.status != "queued":
                    return
                workspace_id = require_workspace_id(task.workspace_id, subject="video export task")
                bind_workspace(session, workspace_id)
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.result_detail = {**(task.result_detail or {}), "phase": "preparing"}
                task.progress = 1
                task.revision += 1
                await session.commit()
                snapshot = await session.get(GalgameStorySnapshot, task.snapshot_id)
                project = await session.get(GalgameWorkshopProject, task.project_id)
                if snapshot is None or project is None:
                    raise RuntimeError("导出快照或项目已不存在")
                document = dict(snapshot.document)
                project_id = task.project_id
                payload = dict(task.request_payload)
                total_ms = int((task.result_detail or {}).get("totalMs", 0))
                ending_label = str((task.result_detail or {}).get("endingLabel", "故事结束"))
                fragment_durations_ms = list(
                    (task.result_detail or {}).get("fragmentDurationsMs", [])
                )
                file_ids = [
                    item.get("fileId") for item in document.get("assets", []) if item.get("fileId")
                ]
                assets = (
                    list(
                        (
                            await session.execute(
                                select(VisualAsset).where(VisualAsset.id.in_(file_ids))
                            )
                        ).scalars()
                    )
                    if file_ids
                    else []
                )
                asset_paths = {item.id: self.storage.path_for(item) for item in assets}
                asset_fingerprints = {
                    item.id: (f"{item.id}:{item.revision}:{item.storage_version}:{item.byte_size}")
                    for item in assets
                }
                metadata_rows = (
                    list(
                        (
                            await session.execute(
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

            await self._raise_if_cancelled(task_id)
            with TemporaryDirectory(prefix=f"galgame-video-{task_id}-") as temp_dir:
                root = Path(temp_dir)
                output_path = root / "output.mp4"
                cancel_event = threading.Event()
                await self._set(task_id, phase="analyzing", progress=2)
                analysis = asyncio.create_task(
                    asyncio.to_thread(
                        prepare_audio_envelopes,
                        document,
                        asset_paths,
                        cache_dir=self.storage.project_root(
                            "galgame-workshop", project_id, workspace_id=workspace_id
                        )
                        / "derived"
                        / "audio-envelopes",
                        asset_fingerprints=asset_fingerprints,
                        selected_fragment_ids=set(payload.get("resolvedFragmentIds") or []),
                        cancel=cancel_event,
                    )
                )
                while not analysis.done():
                    if await self._cancel_requested(task_id):
                        cancel_event.set()
                    await asyncio.sleep(0.25)
                envelopes = await analysis
                await self._raise_if_cancelled(task_id)
                compiled = await asyncio.to_thread(
                    compile_galgame_render_plan,
                    document,
                    payload,
                    fragment_durations_ms=fragment_durations_ms,
                    total_ms=total_ms,
                    asset_paths=asset_paths,
                    asset_duration_ms=asset_duration_ms,
                    audio_envelopes=envelopes,
                )
                await self._raise_if_cancelled(task_id)
                await self._set(task_id, phase="rendering", progress=3)
                render_progress = [3]

                def report(value: int) -> None:
                    render_progress[0] = max(3, min(88, value))

                rendering = asyncio.create_task(
                    asyncio.to_thread(
                        render_plan,
                        compiled.plan,
                        output_path,
                        preset=str(payload.get("preset", "1080p30")),
                        start_us=0,
                        end_us=max(1, total_ms * 1000),
                        cancel=cancel_event,
                        progress=report,
                    )
                )
                while not rendering.done():
                    if await self._cancel_requested(task_id):
                        cancel_event.set()
                    await self._set(
                        task_id,
                        phase="rendering",
                        progress=render_progress[0],
                        rendered_ms=round(total_ms * render_progress[0] / 88),
                    )
                    await asyncio.sleep(0.75)
                try:
                    await rendering
                except RenderCancelled:
                    await self._set(
                        task_id,
                        status="cancelled",
                        phase="cancelled",
                        error=None,
                        finished=True,
                    )
                    return
                await self._raise_if_cancelled(task_id)
                if not output_path.is_file():
                    raise RuntimeError("确定性渲染器没有生成输出文件")
                await self._set(task_id, phase="verifying", progress=90)
                probe = await asyncio.to_thread(_probe_video, output_path)
                await self._raise_if_cancelled(task_id)
                streams = probe.get("streams", [])
                video = next((item for item in streams if item.get("codec_type") == "video"), None)
                audio = next((item for item in streams if item.get("codec_type") == "audio"), None)
                width, height, expected_fps = PRESETS[payload.get("preset", "1080p30")]
                if video is None or video.get("codec_name") != "h264":
                    raise RuntimeError("导出结果缺少 H.264 视频轨")
                if int(video.get("width", 0)) != width or int(video.get("height", 0)) != height:
                    raise RuntimeError("导出结果分辨率不符合预设")
                if video.get("pix_fmt") != "yuv420p":
                    raise RuntimeError("导出结果不是兼容性要求的 yuv420p 视频")
                numerator, _, denominator = str(video.get("avg_frame_rate", "0/1")).partition("/")
                actual_fps = float(numerator or 0) / max(1.0, float(denominator or 1))
                if abs(actual_fps - expected_fps) > 0.05:
                    raise RuntimeError(f"导出帧率不稳定，请改用 {width}×{height} / 30fps")
                if audio is None or audio.get("codec_name") != "aac":
                    raise RuntimeError("导出结果缺少 AAC 音频轨")
                actual_duration_ms = round(float(probe["format"]["duration"]) * 1000)
                frame_ms = 1000 / expected_fps
                if abs(actual_duration_ms - total_ms) > frame_ms + 2:
                    raise RuntimeError("导出结果时长与所选路线不一致")
                timestamp = utc_now().strftime("%Y%m%d-%H%M%S")
                project_label = _safe_filename(project.title)
                ending_filename = _safe_filename(ending_label)
                filename = f"{project_label}-{ending_filename}-{timestamp}.mp4"
                await self._raise_if_cancelled(task_id)
                await self._set(task_id, phase="registering", progress=95)
                async with self.session_factory() as session:
                    bind_workspace(session, workspace_id)
                    library = AssetLibrary(session, self.settings)
                    asset, staged_path = await library.stage_local_copy(
                        output_path,
                        workspace_id=workspace_id,
                        filename=filename,
                        content_type="video/mp4",
                        galgame_project_id=project_id,
                        allowed_extensions={".mp4"},
                        max_bytes=self.settings.fpl_galgame_export_max_bytes,
                    )
                    try:
                        metadata = GalgameAssetMetadata(
                            asset_id=asset.id,
                            project_id=project_id,
                            category="video",
                            virtual_path=f"exports/{filename}",
                            packaging_policy=EXPORT_PACKAGING_POLICY,
                            checksum_sha256=await asyncio.to_thread(sha256_file, output_path),
                            width=width,
                            height=height,
                            duration_ms=actual_duration_ms,
                        )
                        session.add(metadata)
                        session.add(
                            GalgameProjectAssetReference(project_id=project_id, asset_id=asset.id)
                        )
                        await session.commit()
                    except Exception:
                        await session.rollback()
                        staged_path.unlink(missing_ok=True)
                        raise
                await self._set(
                    task_id,
                    status="completed",
                    phase="completed",
                    progress=100,
                    rendered_ms=total_ms,
                    output_asset_id=asset.id,
                    output_filename=filename,
                    finished=True,
                )
        except InterruptedError:
            await self._set(
                task_id,
                status="cancelled",
                phase="cancelled",
                error=None,
                finished=True,
            )
        except Exception as exc:
            await self._set(
                task_id,
                status="failed",
                phase="failed",
                error=str(exc)[:4000],
                finished=True,
            )
