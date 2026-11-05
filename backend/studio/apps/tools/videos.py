"""Tools-owned video jobs, output verification and browser download access."""

import re
from datetime import timedelta
from uuid import uuid4

from pydantic import ValidationError

from app.tool_navigation.video_download_contracts import (
    VideoDownloadAssetOut,
    VideoDownloadJobCreate,
    VideoDownloadJobOut,
)
from app.tool_navigation.video_download_errors import VideoDownloadError
from app.tool_navigation.video_download_source import extract_video_url
from studio.apps.tools.storage.service_models import ToolsNativeJob
from studio.contracts.agent_workbench.native import NativeOutcome
from studio.contracts.tools.tools_native import PROBE_VIDEO_SUBMIT
from studio.contracts.tools.tools_video import DOWNLOAD_VIDEO, VideoDownloadResult
from studio.runtime.tasks.native_queue import NativeQueueError
from studio.runtime.time import iso_utc, utc_now

from .video_files import DownloadFiles

DOWNLOAD_WINDOW_SECONDS = 2 * 60 * 60


class Videos:
    def __init__(self, host, library):
        self.host, self.database, self.library = host, host.database, library
        self.files = DownloadFiles(self.database)

    async def create(self, owner, assertion, body, *, local):
        if body.use_browser_cookies and not local:
            raise VideoDownloadError(
                "读取浏览器 Cookie 需要本机浏览器 Session",
                code="local_access_required",
                status=403,
            )
        if body.folder_id is not None and not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", body.folder_id):
            raise VideoDownloadError("目标文件夹无效", code="invalid_request")
        url = extract_video_url(body.url)
        deps = await self.host.video_dependencies(
            owner, assertion, local=local, operation=PROBE_VIDEO_SUBMIT
        )
        if not deps.ready:
            missing = [
                binary.hint or f"安装 {binary.name}"
                for binary in (deps.yt_dlp, deps.ffmpeg)
                if not binary.ok
            ]
            raise VideoDownloadError("；".join(missing), code="missing_deps")
        job = await self.host.queue.enqueue(
            owner=owner,
            operation=DOWNLOAD_VIDEO,
            payload={
                "assertion": assertion,
                "deadline": (utc_now() + timedelta(seconds=DOWNLOAD_WINDOW_SECONDS)).isoformat(),
                "download": body.model_copy(update={"url": url}).model_dump(mode="json"),
            },
            request_id=uuid4().hex,
        )
        return await self.get(owner, job["id"])

    async def _row(self, owner, job_id):
        try:
            await self.host.queue.get(owner=owner, job_id=job_id)
        except NativeQueueError as exc:
            raise VideoDownloadError("下载任务不存在", code="not_found", status=404) from exc
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            row = await session.get(ToolsNativeJob, job_id)
            if row is None or row.operation != DOWNLOAD_VIDEO:
                raise VideoDownloadError("下载任务不存在", code="not_found", status=404)
            return row

    async def get(self, owner, job_id):
        row = await self._row(owner, job_id)
        body = VideoDownloadJobCreate.model_validate(row.payload["download"])
        stored = row.result or {}
        status = {"queued": "queued", "leased": "running", "completed": "succeeded"}.get(
            row.status, "failed"
        )
        return VideoDownloadJobOut(
            id=row.id,
            status=status,
            url=body.url,
            quality=body.quality,
            use_browser_cookies=body.use_browser_cookies,
            cookies_from_browser=body.cookies_from_browser if body.use_browser_cookies else None,
            save_to_disk=body.save_to_disk,
            save_to_library=body.save_to_library,
            title=stored.get("title"),
            filename=stored.get("filename"),
            byte_size=stored.get("byte_size"),
            error=row.message or None,
            asset=VideoDownloadAssetOut.model_validate(stored["asset"])
            if stored.get("asset")
            else None,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def file(self, owner, job_id):
        row = await self._row(owner, job_id)
        if row.status != "completed" or not row.payload["download"]["save_to_disk"]:
            raise VideoDownloadError("当前任务没有可下载文件", code="file_unavailable", status=404)
        result = await self.files.receipt(owner, job_id)
        if result is None:
            raise VideoDownloadError("下载文件已清理或不存在", code="file_unavailable", status=404)
        return self.files.path(job_id, result), result.filename

    async def accept_file(self, row, result, chunks, *, authorize):
        owner, job_id = row.owner_user_id, row.id
        body = row.payload["download"]
        if row.status == "completed" and not body["save_to_disk"]:
            if await self.files.receipt(owner, job_id) != result:
                raise VideoDownloadError("下载文件回执冲突", code="output_conflict", status=409)
            return
        description = await self.files.store(owner, job_id, result, chunks, authorize=authorize)
        if body["save_to_library"] and not await self.files.library_receipt(owner, job_id):
            asset = await self.library.store(
                assertion=row.payload["assertion"],
                job_id=job_id,
                folder_id=body["folder_id"],
                path=self.files.path(job_id, description),
                result=description,
            )
            await self.files.record_library(owner, job_id, asset)

    async def confirmed(self, lease, outcome):
        if outcome.status != "completed":
            return outcome
        try:
            requested = VideoDownloadResult.model_validate(outcome.result)
        except ValidationError as exc:
            raise VideoDownloadError(
                "下载结果回执无效", code="output_conflict", status=409
            ) from exc
        job_id, owner = str(lease.job_id), lease.owner_user_id
        saved = await self.files.receipt(owner, job_id)
        if saved != requested:
            raise VideoDownloadError("下载结果回执无效", code="output_conflict", status=409)
        row = await self._row(owner, job_id)
        asset = await self.files.library_receipt(owner, job_id)
        if row.payload["download"]["save_to_library"] and asset is None:
            raise VideoDownloadError(
                "下载文件入库结果未确认", code="library_output_unconfirmed", status=503
            )
        return NativeOutcome(
            status="completed",
            result={
                **saved.model_dump(mode="json"),
                "asset": asset,
            },
        )

    async def discard_library_only_file(self, lease):
        owner, job_id = lease.owner_user_id, str(lease.job_id)
        row = await self._row(owner, job_id)
        if row.status != "completed" or row.payload["download"]["save_to_disk"]:
            return
        result = await self.files.receipt(owner, job_id)
        if result is None:
            return
        try:
            self.files.path(job_id, result).unlink()
        except (VideoDownloadError, FileNotFoundError):
            # Replaying the final receipt may find a file already released.
            pass
