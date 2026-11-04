"""Mac worker for a fixed library reveal. The service never sends a host path."""

import argparse
import asyncio
import base64
import contextlib
import logging
import os
import stat
import subprocess
from pathlib import Path
from uuid import UUID

import httpx

from app.tool_navigation.video_download_dependencies import probe_deps
from app.tool_navigation.video_download_errors import VideoDownloadError
from fpl_runtime.locking import service_lock
from fpl_runtime.native_protocol import NativeLease, NativeOutcome
from fpl_runtime.project_reveal import PROJECT_REVEAL, REVEAL_APPLICATIONS, reveal_payload
from fpl_runtime.tools_native import HOST_OPERATIONS, OPEN_LIBRARY, VIDEO_PROBES
from fpl_runtime.tools_video import (
    DOWNLOAD_VIDEO,
    OUTPUT_DESCRIPTOR_HEADER,
    VideoDownloadInput,
    VideoDownloadResult,
)

from .receipts import ReceiptStore
from .tools_video import VideoWorkspace
from .transport import LeaseEnded, NativeTransport, ProtocolConflict

logger = logging.getLogger(__name__)


def reveal(root, owner, parts, missing, *, launch=subprocess.Popen):
    try:
        owner_id = str(UUID(owner))
    except (ValueError, TypeError, AttributeError):
        return {"error": missing}
    if owner != owner_id:
        return {"error": missing}
    path = root
    for segment in ("accounts", owner_id, *parts):
        path = path / segment
        if path.is_symlink() or not path.is_dir():
            return {"error": missing}
    if not path.resolve().is_relative_to(root):
        return {"error": missing}
    try:
        launch(
            ["/usr/bin/open", str(path)],
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            close_fds=True,
        )
    except OSError:
        return {"error": "folder_open_unavailable"}
    return {"opened": True}


def reveal_library(root, owner, *, launch=subprocess.Popen):
    return reveal(root, owner, ("library", "assets"), "library_folder_missing", launch=launch)


def reveal_workshop_project(root, owner, application, project_id, *, launch=subprocess.Popen):
    if application not in REVEAL_APPLICATIONS.values():
        return {"error": "project_folder_missing"}
    scope = reveal_payload({"project_id": project_id})
    return reveal(
        root,
        owner,
        ("applications", application, "projects", scope["project_id"]),
        "project_folder_missing",
        launch=launch,
    )


def reveal_video_project(root, owner, project_id, *, launch=subprocess.Popen):
    return reveal_workshop_project(root, owner, "video-editor", project_id, launch=launch)


class ToolsWorker:
    def __init__(
        self,
        transport,
        assets_root,
        state_root,
        *,
        reveal=reveal_library,
        reveal_project=reveal_video_project,
        reveal_workshop=reveal_workshop_project,
        dependencies=probe_deps,
        downloader=None,
    ):
        if assets_root.is_symlink() or not assets_root.is_dir():
            raise ValueError("Tools worker 必须指定真实的 Assets 状态目录")
        self.assets_root = assets_root.resolve()
        self.transport, self.reveal = transport, reveal
        self.reveal_project, self.reveal_workshop = reveal_project, reveal_workshop
        self.dependencies = dependencies
        self.videos = VideoWorkspace(state_root, **({"download": downloader} if downloader else {}))
        self.receipts = ReceiptStore(
            state_root / "receipts",
            readonly_operations=VIDEO_PROBES,
            retain_acknowledged_payload=False,
        )

    async def deliver(self, lease, outcome):
        error = outcome.result.get("error")
        if outcome.status == "completed" and error in {
            "library_folder_missing",
            "project_folder_missing",
            "folder_open_unavailable",
            "authorization_revoked",
        }:
            outcome = NativeOutcome(status="failed", error_code=error)
        if lease.operation == DOWNLOAD_VIDEO and outcome.status == "completed":
            if "download_error" in outcome.result:
                outcome = NativeOutcome(
                    status="failed",
                    error_code=outcome.result["download_error"],
                    message=outcome.result["message"],
                )
            else:
                outcome = await self._upload(lease, outcome)
        response = await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if response.get("acknowledged") is not True:
            raise ProtocolConflict("Tools 回执未确认")
        self.receipts.acknowledge(lease)
        if lease.operation == DOWNLOAD_VIDEO:
            self.videos.forget(lease.job_id)

    async def _upload(self, lease, outcome):
        result = VideoDownloadResult.model_validate(outcome.result)
        path = await asyncio.to_thread(self.videos.result_path, lease.job_id, result)

        async def chunks():
            with path.open("rb") as source:
                while chunk := await asyncio.to_thread(source.read, 1024 * 1024):
                    yield chunk

        encoded = base64.b64encode(result.model_dump_json().encode()).decode()
        async with contextlib.aclosing(chunks()) as content:
            response = await self.transport.client.post(
                f"_native/v1/download-outputs/{lease.job_id}/{lease.lease_id}",
                headers={
                    "Content-Length": str(result.byte_size),
                    "Content-Type": "application/octet-stream",
                    OUTPUT_DESCRIPTOR_HEADER: encoded,
                },
                content=content,
                timeout=600,
            )
        if response.status_code in {401, 403, 410}:
            return NativeOutcome(
                status="failed",
                error_code="authorization_revoked",
                message="下载交付授权已撤销",
            )
        if response.status_code in {404, 413, 422}:
            return NativeOutcome(
                status="failed",
                error_code="delivery_rejected",
                message="下载文件未通过交付校验",
            )
        if response.status_code == 409:
            raise ProtocolConflict("下载产物与服务的回执冲突")
        response.raise_for_status()
        try:
            body = response.json()
        except ValueError as exc:
            raise ProtocolConflict("下载产物回执格式无效") from exc
        if not isinstance(body, dict) or body.get("stored") is not True:
            raise ProtocolConflict("下载产物未取得持久确认")
        return outcome

    async def _heartbeat(self, lease):
        while True:
            await asyncio.sleep(15)
            try:
                response = await self.transport.post(
                    "heartbeat", {"lease": lease.model_dump(mode="json")}
                )
            except (LeaseEnded, httpx.HTTPError, ProtocolConflict):
                return
            if response.get("active") is not True:
                return

    async def execute(self, lease):
        if lease.operation not in HOST_OPERATIONS or (
            lease.operation not in {DOWNLOAD_VIDEO, *REVEAL_APPLICATIONS} and lease.payload
        ):
            raise ProtocolConflict("Tools 租约超出原生能力")
        if lease.operation == DOWNLOAD_VIDEO:
            VideoDownloadInput.model_validate(lease.payload)
        elif lease.operation in REVEAL_APPLICATIONS:
            try:
                reveal_payload(lease.payload)
            except ValueError as exc:
                raise ProtocolConflict("项目文件夹租约范围无效") from exc
        try:
            result = await self.transport.post(
                "authorize", {"lease": lease.model_dump(mode="json")}
            )
            if result.get("active") is not True:
                raise LeaseEnded("Tools 授权已撤销")
        except LeaseEnded:
            return await asyncio.to_thread(
                self.receipts.execute, lease, lambda *_: {"error": "authorization_revoked"}
            )

        def action(operation, _payload):
            if operation == OPEN_LIBRARY:
                return self.reveal(self.assets_root, lease.owner_user_id)
            if operation == PROJECT_REVEAL:
                return self.reveal_project(
                    self.assets_root, lease.owner_user_id, lease.payload["project_id"]
                )
            if operation in REVEAL_APPLICATIONS:
                return self.reveal_workshop(
                    self.assets_root,
                    lease.owner_user_id,
                    REVEAL_APPLICATIONS[operation],
                    lease.payload["project_id"],
                )
            if operation in VIDEO_PROBES:
                return self.dependencies().model_dump(mode="json")
            try:
                return self.videos.execute(lease.job_id, lease.payload).model_dump(mode="json")
            except VideoDownloadError as exc:
                return {"download_error": exc.code[:100], "message": str(exc)[:1000]}

        return await asyncio.to_thread(self.receipts.execute, lease, action)

    async def poll_once(self):
        for lease, stored in self.receipts.pending():
            if stored is None:
                outcome = await asyncio.to_thread(self.receipts.execute, lease, lambda *_: None)
            else:
                outcome = NativeOutcome.model_validate(stored)
            await self.deliver(lease, outcome)
        result = await self.transport.post("claim", {"wait_seconds": 1})
        if result.get("lease"):
            lease = NativeLease.model_validate(result["lease"])
            heartbeat = (
                asyncio.create_task(self._heartbeat(lease))
                if lease.operation == DOWNLOAD_VIDEO
                else None
            )
            try:
                await self.deliver(lease, await self.execute(lease))
            finally:
                if heartbeat is not None:
                    heartbeat.cancel()
                    await asyncio.gather(heartbeat, return_exceptions=True)

    async def run(self):
        try:
            while True:
                try:
                    await self.poll_once()
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(1)
                except (LeaseEnded, ProtocolConflict):
                    logger.warning("Tools worker 凭据或回执未确认")
                    await asyncio.sleep(3)
        finally:
            await self.transport.close()


async def serve(options, credential):
    transport = NativeTransport(base_url=options.bridge, credential=credential, service="tools")
    worker = ToolsWorker(transport, options.assets_root, options.state_root)
    await worker.run()


def main():
    parser = argparse.ArgumentParser(description="FPL Mac Tools worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--assets-root", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    options = parser.parse_args()
    info = options.worker_token.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        parser.error("Tools worker 凭据必须为本用户独占的普通文件")
    credential = options.worker_token.read_text().strip()
    with service_lock(options.state_root):
        asyncio.run(serve(options, credential))


if __name__ == "__main__":
    main()
