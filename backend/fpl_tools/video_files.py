"""Stage owned download bytes and publish a digest-checked receipt."""

import asyncio
import hashlib
import os
from uuid import UUID, uuid4

from sqlalchemy import text

from app.tool_navigation.video_download_errors import VideoDownloadError
from fpl_runtime.tools_video import DOWNLOAD_VIDEO, VideoDownloadResult

from .models import ToolsDownloadArtifact, ToolsNativeJob


class DownloadFiles:
    def __init__(self, database):
        self.database = database
        self.root = database.root / "video-results"

    def _path(self, job_id, digest):
        job = self.root / str(UUID(str(job_id)))
        if (
            self.root.is_symlink()
            or job.is_symlink()
            or not job.resolve().is_relative_to(self.root)
        ):
            raise VideoDownloadError("下载文件目录无效", code="file_unavailable", status=404)
        return job / digest

    async def receipt(self, owner, job_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            job = await session.get(ToolsNativeJob, str(job_id))
            if job is None or job.operation != DOWNLOAD_VIDEO:
                raise VideoDownloadError("下载任务不存在", code="not_found", status=404)
            saved = await session.get(ToolsDownloadArtifact, str(job_id))
            return VideoDownloadResult.model_validate(saved.description) if saved else None

    async def library_receipt(self, owner, job_id):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(ToolsDownloadArtifact, str(job_id))
            return row.library_asset if row else None

    async def record_library(self, owner, job_id, asset):
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(ToolsDownloadArtifact, str(job_id))
            payload = asset.model_dump(mode="json")
            if row is None or (row.library_asset is not None and row.library_asset != payload):
                raise VideoDownloadError("下载文件入库回执冲突", code="output_conflict", status=409)
            row.library_asset = payload
            await session.commit()

    def path(self, job_id, result):
        path = self._path(job_id, result.content_sha256)
        if path.is_symlink() or not path.is_file() or path.stat().st_size != result.byte_size:
            raise VideoDownloadError("下载文件已清理或不存在", code="file_unavailable", status=404)
        return path

    def _publish(self, temporary, target, expected):
        try:
            os.link(temporary, target)
        except FileExistsError as exc:
            if (
                VideoDownloadResult.from_file(
                    target,
                    title=expected.title,
                    filename=expected.filename,
                    mime_type=expected.mime_type,
                )
                != expected
            ):
                raise VideoDownloadError(
                    "下载文件摘要冲突", code="output_changed", status=409
                ) from exc
        directory = os.open(target.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)

    async def store(self, owner, job_id, result, chunks, *, authorize=None):
        previous = await self.receipt(owner, job_id)
        if previous is not None:
            self.path(job_id, previous)
            if previous != result:
                raise VideoDownloadError("下载文件回执冲突", code="output_conflict", status=409)
            return previous
        target = self._path(job_id, result.content_sha256)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = target.with_name(".upload-" + uuid4().hex)
        digest, size = hashlib.sha256(), 0
        try:
            flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
            with os.fdopen(os.open(temporary, flags, 0o600), "wb") as sink:
                async for chunk in chunks:
                    size += len(chunk)
                    if size > result.byte_size:
                        raise VideoDownloadError("下载文件长度不符", code="output_changed")
                    digest.update(chunk)
                    await asyncio.to_thread(sink.write, chunk)
                await asyncio.to_thread(sink.flush)
                await asyncio.to_thread(os.fsync, sink.fileno())
            if size != result.byte_size or digest.hexdigest() != result.content_sha256:
                raise VideoDownloadError("下载文件长度或摘要不符", code="output_changed")
            if authorize is not None:
                await authorize()
            await asyncio.to_thread(self._publish, temporary, target, result)
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(text("BEGIN IMMEDIATE"))
                previous = await session.get(ToolsDownloadArtifact, str(job_id))
                payload = result.model_dump(mode="json")
                if previous is None:
                    session.add(
                        ToolsDownloadArtifact(
                            job_id=str(job_id), owner_user_id=owner, description=payload
                        )
                    )
                elif previous.description != payload:
                    raise VideoDownloadError("下载文件回执冲突", code="output_conflict", status=409)
                await session.commit()
            return result
        finally:
            temporary.unlink(missing_ok=True)
