from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import shutil
import signal
import subprocess
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.core.config import Settings, get_settings
from app.core.db import SessionLocal
from app.core.tenant_context import bind_workspace
from app.core.time import utc_now
from app.files.library import AssetLibrary
from app.files.storage import AssetStorage
from app.galgame_workshop.video_export_planning import (
    CHOICE_DURATION_MS,
    CHOICE_HIGHLIGHT_MS,
    EXPORT_PACKAGING_POLICY,
    PRESETS,
)
from app.llm.generation_runtime import PollingGenerationRunner
from app.models import (
    GalgameAssetMetadata,
    GalgameProjectAssetReference,
    GalgameStorySnapshot,
    GalgameVideoExportTask,
    GalgameWorkshopProject,
    VisualAsset,
)


def _safe_filename(value: str) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\x00-\x1f]+", "-", value).strip(" .-")
    return (cleaned or "galgame-export")[:180]


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


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


class GalgameVideoExportRunner(PollingGenerationRunner):
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
                row.status = "queued"
                row.cancel_requested = False
                row.error = None
                row.result_detail = {**(row.result_detail or {}), "phase": "queued"}
                row.revision += 1
                row.updated_at = utc_now()
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
            bind_workspace(session, task.workspace_id)
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

    async def _process(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await session.get(GalgameVideoExportTask, task_id)
                if task is None or task.status != "queued":
                    return
                bind_workspace(session, task.workspace_id)
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
                workspace_id = task.workspace_id
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
                asset_paths = {item.id: str(self.storage.path_for(item)) for item in assets}

            render_script = (
                Path(__file__).resolve().parents[3] / "web" / "scripts" / "render-galgame-video.mjs"
            )
            with TemporaryDirectory(prefix=f"galgame-video-{task_id}-") as temp_dir:
                root = Path(temp_dir)
                manifest_path = root / "manifest.json"
                output_path = root / "output.mp4"
                manifest_path.write_text(
                    json.dumps(
                        {
                            "taskId": task_id,
                            "rendererUrl": self.settings.fpl_galgame_renderer_url,
                            "document": document,
                            "assetPaths": asset_paths,
                            "locale": payload.get("locale", "zh"),
                            "preset": payload.get("preset", "1080p30"),
                            "fragmentIds": payload.get("fragmentIds", []),
                            "fragmentDurationsMs": fragment_durations_ms,
                            "clipRange": payload.get("clipRange"),
                            "captureFrame": payload.get(
                                "captureFrame",
                                {"x": 0, "y": 0, "width": 1920, "height": 1080},
                            ),
                            "branchSelections": payload.get("branchSelections", []),
                            "choiceDurationMs": CHOICE_DURATION_MS,
                            "choiceHighlightMs": CHOICE_HIGHLIGHT_MS,
                            "totalMs": total_ms,
                        },
                        ensure_ascii=False,
                    ),
                    encoding="utf-8",
                )
                await self._set(task_id, phase="rendering", progress=2)
                process = await asyncio.create_subprocess_exec(
                    shutil.which("node") or "node",
                    str(render_script),
                    str(manifest_path),
                    str(output_path),
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    start_new_session=True,
                )
                stderr_chunks: list[bytes] = []

                async def read_stderr() -> None:
                    assert process.stderr is not None
                    while chunk := await process.stderr.read(8192):
                        stderr_chunks.append(chunk)
                        if sum(map(len, stderr_chunks)) > 64_000:
                            stderr_chunks.pop(0)

                stderr_task = asyncio.create_task(read_stderr())
                assert process.stdout is not None
                try:
                    while True:
                        try:
                            line = await asyncio.wait_for(process.stdout.readline(), timeout=1.0)
                        except TimeoutError:
                            line = b""
                        if await self._cancel_requested(task_id):
                            if process.returncode is None:
                                os.killpg(process.pid, signal.SIGTERM)
                            await process.wait()
                            await stderr_task
                            await self._set(
                                task_id,
                                status="cancelled",
                                phase="cancelled",
                                error=None,
                                finished=True,
                            )
                            return
                        if line:
                            try:
                                event = json.loads(line)
                            except (json.JSONDecodeError, UnicodeDecodeError):
                                event = {}
                            rendered_ms = int(event.get("renderedMs", 0))
                            phase = str(event.get("phase", "rendering"))
                            progress = (
                                min(88, 2 + round(rendered_ms / total_ms * 86))
                                if total_ms > 0
                                else 2
                            )
                            await self._set(
                                task_id,
                                phase=(
                                    phase if phase in {"rendering", "encoding"} else "rendering"
                                ),
                                progress=progress,
                                rendered_ms=rendered_ms,
                            )
                        if process.returncode is not None:
                            break
                        if not line:
                            try:
                                await asyncio.wait_for(process.wait(), timeout=0.01)
                            except TimeoutError:
                                continue
                finally:
                    if process.returncode is None:
                        try:
                            os.killpg(process.pid, signal.SIGTERM)
                        except ProcessLookupError:
                            pass
                        await asyncio.shield(process.wait())
                await stderr_task
                if process.returncode != 0:
                    message = b"".join(stderr_chunks).decode(errors="replace").strip()
                    raise RuntimeError(message[-4000:] or "视频渲染器执行失败")
                if not output_path.is_file():
                    raise RuntimeError("视频渲染器没有生成输出文件")
                await self._set(task_id, phase="verifying", progress=90)
                probe = await asyncio.to_thread(_probe_video, output_path)
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
                await self._set(task_id, phase="registering", progress=95)
                async with self.session_factory() as session:
                    bind_workspace(session, workspace_id)
                    library = AssetLibrary(session, self.settings)
                    asset, staged_path = await library.stage_local_copy(
                        output_path,
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
                            checksum_sha256=await asyncio.to_thread(_sha256_file, output_path),
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
        except Exception as exc:
            await self._set(
                task_id,
                status="failed",
                phase="failed",
                error=str(exc)[:4000],
                finished=True,
            )
