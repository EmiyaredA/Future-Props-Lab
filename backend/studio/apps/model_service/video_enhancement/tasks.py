"""Admission, durable checkpoints and one local video runner per website process."""

import asyncio
import logging
import os
import shutil
from collections.abc import Awaitable, Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from studio.apps.model_service.inference.storage import InferenceStorage
from studio.apps.model_service.local_models.catalog import require_ready
from studio.apps.model_service.storage.models.model_inference import ModelInferenceAsset
from studio.apps.model_service.storage.models.model_service import ModelEntry, ModelProvider
from studio.apps.model_service.storage.models.video_enhancement import VideoEnhancementTask
from studio.apps.model_service.video_enhancement import media
from studio.contracts.model_service.schemas.video_enhancement import (
    VideoEnhancementOut,
    VideoEnhancementSegment,
)
from studio.contracts.model_service.video_runtime import VideoMemoryError, VideoRuntimeError
from studio.runtime.operation_errors import OperationError
from studio.runtime.tasks.blocking_io import run_blocking_io

logger = logging.getLogger(__name__)
ACTIVE = {"analyzing", "running", "combining", "pausing"}
ROOT_URL = "/v1/model-inference/video-enhancements"


@dataclass(frozen=True)
class VideoBackend:
    provider_kind: str
    revision: str
    available: Callable[[], bool]
    engine: Callable[[Path], Awaitable] | None = None


class VideoEnhancement:
    def __init__(self, sessions, settings, backends, *, owner_active):
        self.sessions = sessions
        self.storage = InferenceStorage(settings)
        self.backends = backends
        self.owner_active = owner_active
        self.lock = asyncio.Lock()
        self.runner = None
        self.current = None
        self.job = None

    async def recover(self):
        async with self.sessions() as session:
            await session.execute(
                update(VideoEnhancementTask)
                .where(VideoEnhancementTask.status.in_(ACTIVE))
                .values(status="interrupted", revision=VideoEnhancementTask.revision + 1)
            )
            await session.commit()
        self.kick()

    def kick(self):
        if self.runner is None or self.runner.done():
            self.runner = asyncio.create_task(self.drain())

    async def close(self):
        if self.runner and not self.runner.done():
            self.runner.cancel()
            await asyncio.gather(self.runner, return_exceptions=True)

    async def attached(self, session, owner, model_id):
        if not await self.owner_active(session, owner):
            raise OperationError("账号当前不可执行任务", "account_inactive", 403)
        match = (
            await session.execute(
                select(ModelEntry.slug, ModelProvider.kind)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelEntry.id == model_id,
                    ModelEntry.owner_user_id == owner,
                    ModelEntry.slug.in_(tuple(self.backends)),
                    ModelEntry.enabled.is_(True),
                    ModelProvider.owner_user_id == owner,
                    ModelProvider.enabled.is_(True),
                )
            )
        ).one_or_none()
        backend = self.backends.get(match.slug) if match else None
        if backend is None or match.kind != backend.provider_kind or not backend.available():
            raise OperationError("请先在当前空间启用可用的本地增强服务", "model_unavailable", 409)
        await require_ready(session, match.slug)
        return backend

    async def create(self, owner, body):
        async with self.lock, self.sessions(info={"owner_user_id": owner}) as session:
            prior = await session.scalar(
                select(VideoEnhancementTask).where(
                    VideoEnhancementTask.owner_user_id == owner,
                    VideoEnhancementTask.request_id == body.request_id,
                )
            )
            if prior is not None:
                if (prior.source_id, prior.model_id) != (body.source_id, body.model_id):
                    raise OperationError("请求已用于另一项任务", "idempotency_conflict", 409)
                return await self.output(session, prior)
            backend = await self.attached(session, owner, body.model_id)
            source = await session.get(ModelInferenceAsset, body.source_id)
            if source is None or source.owner_user_id != owner:
                raise OperationError("视频不存在", "not_found", 404)
            if source.media_kind != "video" or source.filename.lower().rsplit(".", 1)[-1] not in {
                "mp4",
                "mov",
            }:
                raise OperationError("请选择 MP4 或 MOV 视频", "invalid_video", 422)
            row = VideoEnhancementTask(
                owner_user_id=owner,
                request_id=body.request_id,
                source_id=body.source_id,
                model_id=body.model_id,
                model_revision=backend.revision,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                raise OperationError("源视频已变更，请刷新重试", "source_changed", 409) from None
            result = await self.output(session, row)
        self.kick()
        return result

    async def get(self, session, owner, task_id):
        row = await session.get(VideoEnhancementTask, task_id)
        if row is None or row.owner_user_id != owner:
            raise OperationError("任务不存在", "not_found", 404)
        return row

    async def list(self, owner, model_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            rows = await session.scalars(
                select(VideoEnhancementTask)
                .where(
                    VideoEnhancementTask.owner_user_id == owner,
                    VideoEnhancementTask.model_id == model_id,
                )
                .order_by(VideoEnhancementTask.created_at.desc(), VideoEnhancementTask.id.desc())
                .limit(30)
            )
            return [await self.output(session, row) for row in rows]

    async def detail(self, owner, task_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            return await self.output(session, await self.get(session, owner, task_id))

    async def output(self, session, row):
        source = await session.get(ModelInferenceAsset, row.source_id)
        url = f"{ROOT_URL}/{row.id}"
        video = media.Video(**row.video) if row.video else None
        parts = []
        for index, (first, last, *_scene) in enumerate(row.segments or ()):
            parts.append(
                VideoEnhancementSegment(
                    index=index,
                    start_seconds=video.seconds(first),
                    end_seconds=video.seconds(last),
                    result_url=f"{url}/segments/{index}/enhanced"
                    if index < row.completed
                    else None,
                    original_url=f"{url}/segments/{index}/original"
                    if index < row.completed
                    else None,
                )
            )
        return VideoEnhancementOut(
            id=row.id,
            model_id=row.model_id,
            filename=source.filename,
            status=row.status,
            completed=row.completed,
            revision=row.revision,
            error_message=row.error_message,
            segments=parts,
            result_url=f"{url}/content" if row.status == "completed" else None,
        )

    def directory(self, owner, task_id):
        root = self.storage.root(owner) / "outputs"
        path = root / ("enhance-" + task_id)
        if path.is_symlink():
            raise OperationError("无效的任务文件目录", "invalid_path", 409)
        return path

    async def content(self, owner, task_id, index=None, variant=None):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.get(session, owner, task_id)
            if index is None and row.status == "completed":
                name = "result.mp4"
            elif index is not None and 0 <= index < row.completed:
                name = f"{index:05d}-{variant}.mp4"
            else:
                raise OperationError("结果尚未生成", "not_found", 404)
            path = self.directory(owner, row.id) / name
            if not path.is_file() or path.is_symlink():
                raise OperationError("结果文件缺失", "not_found", 404)
            return path

    async def action(self, owner, task_id, body):
        async with self.lock, self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.get(session, owner, task_id)
            if row.revision != body.expected_revision:
                raise OperationError("任务状态已更新，请刷新重试", "revision_conflict", 409)
            if body.action == "pause" and row.status in {
                "queued",
                "analyzing",
                "running",
                "combining",
            }:
                row.status = "pausing" if task_id == self.current else "paused"
            elif body.action == "resume" and row.status in {"paused", "interrupted", "failed"}:
                backend = await self.attached(session, owner, row.model_id)
                if row.model_revision != backend.revision:
                    raise OperationError("请恢复任务使用的模型版本", "model_revision_changed", 409)
                row.status, row.error_message = "queued", None
            else:
                raise OperationError("当前状态无法执行此操作", "invalid_task_state", 409)
            row.revision += 1
            await session.commit()
            if row.status == "pausing" and self.job:
                self.job.cancel()
            result = await self.output(session, row)
        self.kick()
        return result

    async def drain(self):
        while any(backend.available() for backend in self.backends.values()):
            async with self.lock, self.sessions() as session:
                row = await session.scalar(
                    select(VideoEnhancementTask)
                    .where(VideoEnhancementTask.status == "queued")
                    .order_by(VideoEnhancementTask.created_at, VideoEnhancementTask.id)
                    .limit(1)
                )
                if row is None:
                    return
                self.current = row.id
                row.status = "running" if row.video else "analyzing"
                row.revision += 1
                await session.commit()
                self.job = asyncio.create_task(self.run(row.owner_user_id, row.id))
            try:
                # Shield separates an intentional user pause from website shutdown.
                await asyncio.shield(self.job)
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    self.job.cancel()
                    await asyncio.gather(self.job, return_exceptions=True)
                    await self.transition(row.owner_user_id, row.id, "interrupted")
                    raise
                await self.transition(row.owner_user_id, row.id, "paused")
            except (media.MediaError, VideoRuntimeError, OperationError) as exc:
                await self.transition(row.owner_user_id, row.id, "failed", str(exc))
            except Exception:
                logger.exception("本地视频增强任务失败")
                await self.transition(
                    row.owner_user_id, row.id, "failed", "本地处理失败，请检查磁盘和运行环境"
                )
            finally:
                self.current = self.job = None

    async def transition(self, owner, task_id, status, error=None):
        async with self.lock, self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.get(session, owner, task_id)
            if row.status in ACTIVE:
                row.status = "paused" if row.status == "pausing" and status == "failed" else status
                row.error_message = error[:512] if error else None
                row.revision += 1
                await session.commit()

    async def run(self, owner, task_id):
        async with self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.get(session, owner, task_id)
            backend = await self.attached(session, owner, row.model_id)
            asset = await session.get(ModelInferenceAsset, row.source_id)
            source = self.storage.root(owner) / "inputs" / asset.storage_key
            if source.is_symlink() or not source.is_file():
                raise media.MediaError("原视频已不可用")
            saved_video, parts, completed = row.video, row.segments, row.completed
            if row.model_revision != backend.revision:
                raise media.MediaError("请恢复任务使用的模型版本")
        video = media.Video(**saved_video) if saved_video else await media.probe(source)
        if parts is None:
            parts = await media.plan(
                source, video, core_frames=240 if backend.engine is None else media.CORE_FRAMES
            )
            await self.checkpoint(
                owner, task_id, video=asdict(video), segments=parts, status="running"
            )
        output = self.directory(owner, task_id)
        output.mkdir(parents=True, exist_ok=True, mode=0o700)
        # Deterministic output names are trusted only after the database checkpoint.
        # An interrupted write can leave a scratch directory. The next attempt clears it.
        for stale in output.glob(".work-*"):
            if stale.is_dir() and not stale.is_symlink():
                await run_blocking_io(shutil.rmtree, stale)
        with TemporaryDirectory(prefix=".work-", dir=output) as folder:
            scratch = Path(folder)
            runtime = await backend.engine(scratch) if backend.engine else None
            try:
                reduced = False
                for index in range(completed, len(parts)):
                    if runtime is None:
                        await media.fast_segment(source, video, parts[index], scratch)
                    else:
                        try:
                            await self.process_segment(
                                source, video, parts[index], scratch, runtime, reduced=reduced
                            )
                        except VideoMemoryError:
                            if reduced:
                                raise
                            await runtime.close()
                            reduced = True
                            await self.process_segment(
                                source, video, parts[index], scratch, runtime, reduced=True
                            )
                    await self.checkpoint(
                        owner,
                        task_id,
                        completed=index + 1,
                        files=tuple(
                            (scratch / f"{name}.mp4", output / f"{index:05d}-{name}.mp4")
                            for name in ("original", "enhanced")
                        ),
                    )
            finally:
                if runtime is not None:
                    await runtime.close()
            await self.checkpoint(owner, task_id, status="combining")
            result = scratch / "result.mp4"
            await media.combine(
                [
                    (output / f"{index:05d}-enhanced.mp4", part[1] - part[0])
                    for index, part in enumerate(parts)
                ],
                source,
                video,
                result,
                scratch,
            )
            await media.verify(result, video, video.frames)
            await self.checkpoint(
                owner, task_id, status="completed", files=((result, output / result.name),)
            )

    async def checkpoint(self, owner, task_id, *, files=(), **updates):
        async with self.lock, self.sessions(info={"owner_user_id": owner}) as session:
            row = await self.get(session, owner, task_id)
            if row.status == "pausing":
                raise asyncio.CancelledError()
            await self.attached(session, owner, row.model_id)
            for source, target in files:
                os.replace(source, target)
            for name, value in updates.items():
                setattr(row, name, value)
            row.revision += 1
            await session.commit()

    @staticmethod
    async def process_segment(source, video, segment, scratch, runtime, *, reduced=False):
        start, end, *_scene = segment
        original, enhanced = scratch / "original.rgb", scratch / "enhanced.rgb"
        original.unlink(missing_ok=True)
        enhanced.unlink(missing_ok=True)
        frame_bytes = video.width * video.height * 3
        for first, last, left, right in media.windows(segment, reduced=reduced):
            await media.extract(source, video, left, right, scratch / "input.rgb")
            await runtime.enhance(video, right - left)
            await run_blocking_io(
                media.append_frames,
                scratch / "input.rgb",
                original,
                first - left,
                last - first,
                frame_bytes,
            )
            await run_blocking_io(
                media.append_frames,
                scratch / "output.rgb",
                enhanced,
                first - left,
                last - first,
                frame_bytes * 4,
            )
        for name, raw, factor in (("original", original, 1), ("enhanced", enhanced, 2)):
            path = scratch / f"{name}.mp4"
            await media.encode(raw, source, video, start, end, factor, path)
            await media.verify(path, video, end - start)
