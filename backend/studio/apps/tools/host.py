"""Account- and session-bound queue for the single local library reveal operation."""

from datetime import datetime, timedelta
from uuid import uuid4

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import select, update

from app.tool_navigation.video_download_contracts import BinaryStatus, VideoDownloadDepsOut
from studio.apps.tools.storage.service_models import ToolsNativeJob
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.asset_library.reveal import REVEAL_APPLICATIONS, reveal_payload
from studio.contracts.tools.tools_native import (
    ERRORS,
    HOST_OPERATIONS,
    OPEN_LIBRARY,
    PROBE_VIDEO,
    VIDEO_PROBES,
)
from studio.contracts.tools.tools_video import DOWNLOAD_VIDEO, VideoDownloadInput
from studio.runtime.tasks.native_queue import NativeQueue, NativeQueueError
from studio.runtime.time import utc_now

WINDOW_SECONDS = 8
DEPENDENCIES_WINDOW_SECONDS = 20


def missing_dependencies():
    hint = "本机视频下载执行器不可用"
    return VideoDownloadDepsOut(
        ready=False,
        yt_dlp=BinaryStatus(name="yt-dlp", ok=False, hint=hint),
        ffmpeg=BinaryStatus(name="ffmpeg", ok=False, hint=hint),
    )


class ToolsHost:
    def __init__(self, database, identity):
        self.database, self.identity = database, identity
        self.queue = NativeQueue(
            database, ToolsNativeJob, operations=HOST_OPERATIONS, clock=utc_now
        )

    async def _live(self, assertion, operation, scope=None):
        if self.identity is None:
            return None
        method, path = HOST_OPERATIONS[operation]
        if operation in REVEAL_APPLICATIONS:
            path = path.format(**reveal_payload(scope or {}))
        return await self.identity.status(assertion=assertion, method=method, path=path)

    async def _run(self, owner, assertion, operation, *, timeout, scope=None):
        active = await self._live(assertion, operation, scope)
        if active is not True:
            raise HTTPException(
                503 if active is None else 403,
                {"code": "folder_open_unavailable" if active is None else "authorization_revoked"},
            )
        deadline = utc_now() + timedelta(seconds=timeout)
        job = await self.queue.enqueue(
            owner=owner,
            operation=operation,
            payload={
                "assertion": assertion,
                "deadline": deadline.isoformat(),
                "scope": scope or {},
            },
            request_id=uuid4().hex,
        )
        try:
            return await self.queue.wait(owner=owner, job_id=job["id"], timeout=timeout)
        except NativeQueueError as exc:
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await session.execute(
                    update(ToolsNativeJob)
                    .where(ToolsNativeJob.id == job["id"], ToolsNativeJob.status == "queued")
                    .values(
                        status="failed",
                        error_code="native_worker_unavailable",
                        revision=ToolsNativeJob.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                await session.commit()
            raise HTTPException(
                503,
                {
                    "code": "folder_open_unavailable",
                    "message": ERRORS["folder_open_unavailable"][1],
                },
            ) from exc

    async def open_library(self, owner, assertion):
        await self.open_folder(owner, assertion, OPEN_LIBRARY)

    async def open_folder(self, owner, assertion, operation, scope=None):
        result = await self._run(owner, assertion, operation, timeout=WINDOW_SECONDS, scope=scope)
        if result["status"] == "completed" and result["result"] == {"opened": True}:
            return
        code = result["error_code"]
        if code not in ERRORS:
            code = "folder_open_unavailable"
        status, message = ERRORS[code]
        raise HTTPException(status, {"code": code, "message": message})

    async def video_dependencies(self, owner, assertion, *, local, operation=PROBE_VIDEO):
        try:
            result = await self._run(
                owner, assertion, operation, timeout=DEPENDENCIES_WINDOW_SECONDS
            )
        except HTTPException as exc:
            if exc.status_code == 503:
                return missing_dependencies()
            raise
        if result["status"] != "completed":
            return missing_dependencies()
        deps = VideoDownloadDepsOut.model_validate(result["result"])
        if not local:
            deps.yt_dlp.path = None
            deps.ffmpeg.path = None
        return deps

    def _worker_payload(self, operation, payload):
        if operation in REVEAL_APPLICATIONS:
            return reveal_payload(payload["scope"])
        if operation != DOWNLOAD_VIDEO:
            return {}
        body = payload["download"]
        return VideoDownloadInput(
            url=body["url"],
            quality=body["quality"],
            cookies_from_browser=body["cookies_from_browser"]
            if body["use_browser_cookies"]
            else None,
        ).model_dump(mode="json")

    async def authorize(self, worker, lease, *, output=False):
        if lease.operation not in HOST_OPERATIONS:
            raise HTTPException(403, "native_operation_forbidden")
        async with self.database.sessions(info={"owner_user_id": lease.owner_user_id}) as session:
            row = await session.scalar(
                select(ToolsNativeJob).where(ToolsNativeJob.id == str(lease.job_id))
            )
            if (
                row is None
                or row.worker_id != worker
                or row.lease_id != str(lease.lease_id)
                or row.operation != lease.operation
                or row.status not in ({"leased", "unknown"} if output else {"leased"})
                or (not output and row.lease_expires_at <= utc_now())
                or lease.payload != self._worker_payload(row.operation, row.payload)
            ):
                raise HTTPException(410, "tools_lease_ended")
            assertion = row.payload["assertion"]
            deadline = datetime.fromisoformat(row.payload["deadline"])
        if (
            deadline <= utc_now()
            or not await self._live(assertion, lease.operation, lease.payload)
            or deadline <= utc_now()
        ):
            raise HTTPException(410, "tools_authorization_ended")
        return row

    async def claim(self, worker):
        lease = await self.queue.claim(worker_id=worker, allowed_operations=HOST_OPERATIONS)
        if lease is None:
            return None
        sanitized = lease.model_copy(
            update={"payload": self._worker_payload(lease.operation, lease.payload)}
        )
        try:
            await self.authorize(worker, sanitized)
        except HTTPException:
            await self.finish(
                worker,
                sanitized,
                NativeOutcome(
                    status="failed",
                    error_code="authorization_revoked",
                    message="原生任务授权已结束",
                ),
            )
            return None
        return sanitized

    async def download_upload(self, worker, job_id, lease_id):
        async with self.database.sessions(info={"allow_system_reads": True}) as session:
            row = await session.scalar(
                select(ToolsNativeJob).where(
                    ToolsNativeJob.id == str(job_id),
                    ToolsNativeJob.lease_id == str(lease_id),
                    ToolsNativeJob.worker_id == worker,
                    ToolsNativeJob.operation == DOWNLOAD_VIDEO,
                )
            )
            if row is None:
                raise HTTPException(410, "tools_lease_ended")
            lease = NativeLease(
                job_id=job_id,
                lease_id=lease_id,
                owner_user_id=row.owner_user_id,
                operation=DOWNLOAD_VIDEO,
                payload=self._worker_payload(DOWNLOAD_VIDEO, row.payload),
                lease_expires_at=row.lease_expires_at.isoformat(),
            )
        if row.status == "completed":
            # Acknowledgement may have been lost after the immutable final receipt.
            return row
        return await self.authorize(worker, lease, output=True)

    async def finish(self, worker, lease, outcome):
        if lease.operation in REVEAL_APPLICATIONS:
            try:
                reveal_payload(lease.payload)
            except ValueError as exc:
                raise HTTPException(422, "tools_outcome_invalid") from exc
        if (lease.operation not in {DOWNLOAD_VIDEO, *REVEAL_APPLICATIONS} and lease.payload) or (
            lease.operation in {OPEN_LIBRARY, *REVEAL_APPLICATIONS}
            and outcome.status == "completed"
            and outcome.result != {"opened": True}
        ):
            raise HTTPException(422, "tools_outcome_invalid")
        if lease.operation in VIDEO_PROBES and outcome.status == "completed":
            try:
                VideoDownloadDepsOut.model_validate(outcome.result)
            except ValidationError as exc:
                raise HTTPException(422, "tools_dependency_receipt_invalid") from exc
        try:
            await self.queue.complete(
                worker_id=worker, lease=lease, outcome=outcome, allowed_operations=HOST_OPERATIONS
            )
        except NativeQueueError as exc:
            raise HTTPException(409, exc.code) from exc
