from __future__ import annotations

import asyncio
import subprocess
import threading
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.capabilities.asset_store.digests import sha256_file
from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.render_engine import RenderCancelled, render_document
from app.models import (
    VideoEditorAssetMetadata,
    VideoEditorProject,
    VideoEditorTask,
    VisualAsset,
)
from app.orm import bind_workspace, require_workspace_id
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from app.schemas.video_editor import VideoEditorTimelineDocument
from app.video_editor.media import probe_media
from app.video_editor.rendering import PRESETS
from app.video_editor.segment_runner import VideoEditorSegmentTaskRunner


def _run(args: list[str]) -> None:
    try:
        result = subprocess.run(args, check=True, capture_output=True, text=True)
    except FileNotFoundError as exc:
        raise RuntimeError(f"缺少媒体处理程序：{args[0]}") from exc
    except subprocess.CalledProcessError as exc:
        raise RuntimeError((exc.stderr or "媒体处理失败")[-4000:]) from exc
    if result.returncode:
        raise RuntimeError((result.stderr or "媒体处理失败")[-4000:])


def _fraction(value: object) -> float:
    text = str(value or "0")
    numerator, separator, denominator = text.partition("/")
    if not separator:
        return float(numerator or 0)
    divisor = float(denominator or 0)
    return float(numerator or 0) / divisor if divisor else 0.0


def _prepare_media(
    source: Path, asset: VisualAsset, derived: Path, probe: dict | None = None
) -> tuple[dict, str | None, str | None, str | None, str]:
    fingerprint = sha256_file(source)
    proxy: str | None = None
    thumbnail: str | None = None
    waveform: str | None = None
    if asset.media_kind == "font":
        return {"mediaKind": "font"}, proxy, thumbnail, waveform, fingerprint
    probe = probe if probe is not None else probe_media(source)
    if asset.media_kind == "video":
        proxy = f"{asset.id}-proxy.mp4"
        thumbnail = f"{asset.id}-thumbnail.png"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vf",
                "scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2",
                "-c:v",
                "libx264",
                "-preset",
                "veryfast",
                "-crf",
                "24",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-movflags",
                "+faststart",
                "-y",
                str(derived / proxy),
            ]
        )
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-ss",
                "0",
                "-i",
                str(source),
                "-frames:v",
                "1",
                "-vf",
                "scale=480:-2",
                "-y",
                str(derived / thumbnail),
            ]
        )
    elif asset.media_kind == "image":
        thumbnail = f"{asset.id}-thumbnail.png"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vf",
                "scale=480:-2",
                "-frames:v",
                "1",
                "-y",
                str(derived / thumbnail),
            ]
        )
    elif asset.media_kind == "audio":
        proxy = f"{asset.id}-proxy.m4a"
        waveform = f"{asset.id}-waveform.png"
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-vn",
                "-c:a",
                "aac",
                "-ar",
                "48000",
                "-b:a",
                "128k",
                "-y",
                str(derived / proxy),
            ]
        )
        _run(
            [
                "ffmpeg",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-filter_complex",
                "showwavespic=s=1200x160:colors=7c6cff",
                "-frames:v",
                "1",
                "-y",
                str(derived / waveform),
            ]
        )
    return probe, proxy, thumbnail, waveform, fingerprint


class VideoEditorRunner(PollingTaskRunner):
    runner_name = "video-editor-runner"
    poll_interval_seconds = 0.75

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
                        select(VideoEditorTask).where(VideoEditorTask.status == "running")
                    )
                ).scalars()
            )
            for row in rows:
                row.status = "queued"
                row.cancel_requested = False
                row.error = None
                row.revision += 1
                row.updated_at = utc_now()
            await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(VideoEditorTask.id)
                .where(VideoEditorTask.status == "queued")
                .order_by(VideoEditorTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _get(self, session: AsyncSession, task_id: str) -> VideoEditorTask | None:
        task = await session.get(VideoEditorTask, task_id)
        if task:
            bind_workspace(
                session,
                require_workspace_id(task.workspace_id, subject="video editor task"),
            )
        return task

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        error: str | None = None,
        result: dict | None = None,
        output_asset_id: str | None = None,
        finished: bool = False,
    ) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            if status is not None:
                task.status = status
            if progress is not None:
                task.progress = max(0, min(100, progress))
            if result is not None:
                task.result_detail = result
            if output_asset_id is not None:
                task.output_asset_id = output_asset_id
            task.error = error
            task.revision += 1
            task.updated_at = utc_now()
            if finished:
                task.finished_at = utc_now()
            await session.commit()

    async def _process(self, task_id: str) -> None:
        try:
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is None or task.status != "queued":
                    return
                if task.cancel_requested:
                    task.status = "cancelled"
                    await session.commit()
                    return
                task.status = "running"
                task.started_at = task.started_at or utc_now()
                task.progress = 1
                task.revision += 1
                await session.commit()
                kind = task.kind
            if kind == "media":
                await self._process_media(task_id)
            elif kind == "segment_export":
                await self._process_segment_export(task_id)
            else:
                await self._process_render(task_id)
        except RenderCancelled:
            await self._set(task_id, status="cancelled", finished=True)
        except Exception as exc:
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is not None and task.kind == "media":
                    asset_id = str((task.request_payload or {}).get("assetId", ""))
                    metadata = await session.get(VideoEditorAssetMetadata, asset_id)
                    if metadata is not None:
                        metadata.processing_status = "failed"
                        metadata.error = str(exc)
                        metadata.revision += 1
                        metadata.updated_at = utc_now()
                        await session.commit()
            await self._set(task_id, status="failed", error=str(exc), finished=True)

    async def _process_media(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            asset_id = str(task.request_payload["assetId"])
            asset = await session.get(VisualAsset, asset_id)
            metadata = await session.get(VideoEditorAssetMetadata, asset_id)
            if asset is None or metadata is None:
                raise RuntimeError("待处理素材不存在")
            metadata.processing_status = "processing"
            metadata.error = None
            metadata.revision += 1
            await session.commit()
            source = self.storage.path_for(asset)
            # Publish source metadata before the potentially long proxy encode.
            # Timeline edits can then use the real duration while preview media
            # continues preparing, without holding a write transaction open.
            probe = (
                {"mediaKind": "font"}
                if asset.media_kind == "font"
                else await asyncio.to_thread(probe_media, source)
            )
            metadata.probe = probe
            metadata.revision += 1
            await session.commit()
            derived = (
                self.storage.project_root(
                    "video-editor", task.project_id, workspace_id=task.workspace_id
                )
                / "derived"
            )
            derived.mkdir(parents=True, exist_ok=True)
            probe, proxy, thumbnail, waveform, fingerprint = await asyncio.to_thread(
                _prepare_media, source, asset, derived, probe
            )
            metadata = await session.get(VideoEditorAssetMetadata, asset_id)
            assert metadata is not None
            metadata.processing_status = "ready"
            metadata.probe = probe
            metadata.proxy_filename = proxy
            metadata.thumbnail_filename = thumbnail
            metadata.waveform_filename = waveform
            metadata.fingerprint = fingerprint
            metadata.error = None
            metadata.revision += 1
            await session.commit()
        await self._set(task_id, status="completed", progress=100, finished=True)

    async def _cancel_watch(self, task_id: str, event: threading.Event) -> None:
        while not event.is_set():
            await asyncio.sleep(0.4)
            async with self.session_factory() as session:
                task = await self._get(session, task_id)
                if task is None or task.cancel_requested:
                    event.set()
                    return

    async def _raise_if_cancelled(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None or task.cancel_requested:
                raise RenderCancelled()

    async def _process_segment_export(self, task_id: str) -> None:
        await VideoEditorSegmentTaskRunner(
            session_factory=self.session_factory,
            settings=self.settings,
            storage=self.storage,
            get_task=self._get,
            set_task=self._set,
            raise_if_cancelled=self._raise_if_cancelled,
        ).process(task_id)

    async def _process_render(self, task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self._get(session, task_id)
            if task is None:
                return
            document = VideoEditorTimelineDocument.model_validate(task.snapshot_document)
            payload = dict(task.request_payload)
            asset_ids = {
                value
                for track in document.tracks
                for clip in track.clips
                for value in (clip.asset_id, clip.font_asset_id)
                if value
            }
            assets = (
                list(
                    (
                        await session.execute(
                            select(VisualAsset).where(
                                VisualAsset.id.in_(asset_ids),
                                VisualAsset.video_editor_project_id == task.project_id,
                            )
                        )
                    ).scalars()
                )
                if asset_ids
                else []
            )
            paths = {asset.id: self.storage.path_for(asset) for asset in assets}
            project_id = task.project_id
            workspace_id = task.workspace_id
            detail = dict(task.result_detail)
        cancel = threading.Event()
        watch = asyncio.create_task(self._cancel_watch(task_id, cancel))
        with TemporaryDirectory(prefix=f"video-editor-{task_id}-") as temporary:
            output = Path(temporary) / "render.mp4"
            loop = asyncio.get_running_loop()

            def progress(value: int) -> None:
                asyncio.run_coroutine_threadsafe(self._set(task_id, progress=value), loop)

            try:
                await asyncio.to_thread(
                    render_document,
                    document,
                    paths,
                    output,
                    preset=str(payload["preset"]),
                    start_us=int(payload.get("startUs", 0)),
                    end_us=int(
                        payload.get("endUs")
                        or int(payload.get("startUs", 0)) + int(detail["durationUs"])
                    ),
                    cancel=cancel,
                    progress=progress,
                )
            finally:
                watch.cancel()
            probe = await asyncio.to_thread(probe_media, output)
            width, height, fps = PRESETS[str(payload["preset"])]
            video = next(
                (
                    stream
                    for stream in probe.get("streams", [])
                    if stream.get("codec_type") == "video"
                ),
                None,
            )
            audio = next(
                (
                    stream
                    for stream in probe.get("streams", [])
                    if stream.get("codec_type") == "audio"
                ),
                None,
            )
            if not video or not audio:
                raise RuntimeError("成片缺少 H.264 画面或 AAC 音轨")
            if (
                video.get("codec_name") != "h264"
                or audio.get("codec_name") != "aac"
                or video.get("width") != width
                or video.get("height") != height
                or video.get("pix_fmt") != "yuv420p"
                or int(audio.get("sample_rate") or 0) != 48_000
            ):
                raise RuntimeError("成片规格校验失败")
            expected_duration_us = int(detail["durationUs"])
            expected_frames = round(expected_duration_us / 1_000_000 * fps)
            actual_frames = int(video.get("nb_frames") or 0)
            actual_fps = _fraction(video.get("avg_frame_rate"))
            duration_delta_us = abs(int(probe.get("durationUs") or 0) - expected_duration_us)
            if (
                actual_frames != expected_frames
                or abs(actual_fps - fps) > 0.001
                or duration_delta_us > max(round(1_000_000 / fps), 2_000)
            ):
                raise RuntimeError("成片帧数、帧率或时长校验失败")
            async with self.session_factory() as session:
                bind_workspace(session, workspace_id)
                project = await session.get(VideoEditorProject, project_id)
                title = project.title if project else "video-editor"
                asset, staged = await AssetLibrary(session, self.settings).stage_local_copy(
                    output,
                    workspace_id=workspace_id,
                    filename=f"{title}-{task_id[:8]}.mp4",
                    content_type="video/mp4",
                    video_editor_project_id=project_id,
                    allowed_extensions={".mp4"},
                    max_bytes=self.settings.fpl_galgame_export_max_bytes,
                )
                try:
                    session.add(
                        VideoEditorAssetMetadata(
                            asset_id=asset.id,
                            project_id=project_id,
                            processing_status="ready",
                            probe=probe,
                            fingerprint=sha256_file(output),
                        )
                    )
                    await session.commit()
                except Exception:
                    staged.unlink(missing_ok=True)
                    raise
                output_asset_id = asset.id
            detail.update({"probe": probe, "outputFilename": f"{title}-{task_id[:8]}.mp4"})
        await self._set(
            task_id,
            status="completed",
            progress=100,
            result=detail,
            output_asset_id=output_asset_id,
            finished=True,
        )
