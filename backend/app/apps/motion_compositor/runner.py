from __future__ import annotations

import asyncio
import shutil
import subprocess
import zipfile
from pathlib import Path
from tempfile import TemporaryDirectory

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.apps.motion_compositor.assets import MotionAssets
from app.apps.motion_compositor.exports import OUTPUT_NAMES
from app.apps.motion_compositor.models import MotionTask
from app.capabilities.asset_store.storage import AssetStorage
from app.capabilities.media_rendering.motion_document import MotionComposition
from app.capabilities.media_rendering.motion_frames import MotionFrameRenderer
from app.orm import bind_owner, require_owner_id
from app.runtime.config import Settings, get_settings
from app.runtime.db import SessionLocal
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now


class MotionExportRunner(PollingTaskRunner):
    runner_name = "motion-compositor-export-runner"
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
            interrupted = list(
                (
                    await session.execute(
                        select(MotionTask.id, MotionTask.owner_user_id).where(
                            MotionTask.status == "running"
                        )
                    )
                ).all()
            )
        for task_id, raw_owner_user_id in interrupted:
            owner_user_id = require_owner_id(raw_owner_user_id, subject="motion export task")
            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                row = await session.get(MotionTask, task_id)
                if row is None or row.status != "running":
                    continue
                row.status = "queued"
                row.progress = 0
                row.outputs = {}
                row.updated_at = utc_now()
                await session.commit()

    async def process_once(self) -> None:
        async with self.session_factory() as session:
            task_id = await session.scalar(
                select(MotionTask.id)
                .where(MotionTask.status == "queued")
                .order_by(MotionTask.created_at)
                .limit(1)
            )
        if task_id:
            await self._process(task_id)

    async def _load_task(self, task_id: str) -> MotionTask | None:
        async with self.session_factory() as session:
            return await session.get(MotionTask, task_id)

    async def _set(
        self,
        task_id: str,
        *,
        status: str | None = None,
        progress: int | None = None,
        outputs: dict | None = None,
        error: str | None = None,
    ) -> None:
        async with self.session_factory() as session:
            row = await session.get(MotionTask, task_id)
            if row is None:
                return
            bind_owner(session, require_owner_id(row.owner_user_id, subject="motion export task"))
            if status is not None:
                row.status = status
            if progress is not None:
                row.progress = progress
            if outputs is not None:
                row.outputs = outputs
            row.error = error
            row.updated_at = utc_now()
            await session.commit()

    async def _cancelled(self, task_id: str) -> bool:
        row = await self._load_task(task_id)
        return row is None or row.cancel_requested

    @staticmethod
    def _encode(frames: Path, output: Path, fps: int, format_name: str) -> None:
        args = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-framerate", str(fps), "-i"]
        args.append(str(frames / ("rgb-%06d.png" if format_name == "mp4" else "alpha-%06d.png")))
        if format_name == "mp4":
            args.extend(
                [
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "medium",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                ]
            )
        else:
            args.extend(
                [
                    "-an",
                    "-c:v",
                    "prores_ks",
                    "-profile:v",
                    "4444",
                    "-pix_fmt",
                    "yuva444p10le",
                    "-alpha_bits",
                    "16",
                ]
            )
        args.extend(["-y", str(output)])
        result = subprocess.run(args, capture_output=True, text=True, check=False)
        if result.returncode:
            raise RuntimeError((result.stderr or "视频编码失败")[-2000:])

    async def _process(self, task_id: str) -> None:
        task = await self._load_task(task_id)
        if task is None or task.status != "queued":
            return
        owner_user_id = require_owner_id(task.owner_user_id, subject="motion export task")
        await self._set(task_id, status="running", progress=1)
        root = self.storage.project_root(
            "motion-compositor", task.project_id, owner_user_id=owner_user_id
        )
        target = root / "exports" / task_id
        try:
            async with self.session_factory() as session:
                bind_owner(session, owner_user_id)
                assets = await MotionAssets(session, owner_user_id).paths(task.project_id)
            document = MotionComposition.model_validate(task.snapshot_document)
            payload = task.request_payload
            start = int(payload["startFrame"])
            end = int(payload.get("endFrame") or document.settings.duration_frames)
            formats = list(payload["formats"])
            with TemporaryDirectory(prefix="motion-render-") as temporary:
                frames = Path(temporary)
                renderer = MotionFrameRenderer(document, assets)
                for index, frame_number in enumerate(range(start, end)):
                    if await self._cancelled(task_id):
                        await self._set(task_id, status="cancelled", progress=0)
                        return
                    image = await asyncio.to_thread(renderer.render, frame_number)
                    if any(name != "mp4" for name in formats):
                        await asyncio.to_thread(image.save, frames / f"alpha-{index:06d}.png")
                    if "mp4" in formats:
                        rgb = Image.new("RGB", image.size, document.settings.background_color)
                        rgb.paste(image, mask=image.getchannel("A"))
                        await asyncio.to_thread(rgb.save, frames / f"rgb-{index:06d}.png")
                    if index % max(1, document.settings.fps // 2) == 0:
                        await self._set(task_id, progress=round((index + 1) / (end - start) * 78))
                target.mkdir(parents=True, exist_ok=True)
                outputs: dict[str, str] = {}
                for index, format_name in enumerate(formats):
                    if await self._cancelled(task_id):
                        await self._set(task_id, status="cancelled", progress=0)
                        shutil.rmtree(target, ignore_errors=True)
                        return
                    filename = OUTPUT_NAMES[format_name]
                    output = target / filename
                    if format_name == "png-sequence":

                        def make_zip(output_path: Path = output) -> None:
                            with zipfile.ZipFile(
                                output_path, "w", compression=zipfile.ZIP_DEFLATED
                            ) as archive:
                                for path in sorted(frames.glob("alpha-*.png")):
                                    archive.write(path, path.name)

                        await asyncio.to_thread(make_zip)
                    else:
                        await asyncio.to_thread(
                            self._encode, frames, output, document.settings.fps, format_name
                        )
                    outputs[format_name] = filename
                    await self._set(task_id, progress=78 + round((index + 1) / len(formats) * 21))
                await self._set(task_id, status="completed", progress=100, outputs=outputs)
        except Exception as exc:
            shutil.rmtree(target, ignore_errors=True)
            await self._set(task_id, status="failed", error=str(exc)[-2000:])
