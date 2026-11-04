"""Mac worker for a fixed library reveal. The service never sends a host path."""

import argparse
import asyncio
import logging
import os
import stat
import subprocess
from pathlib import Path
from uuid import UUID

import httpx

from fpl_runtime.locking import service_lock
from fpl_runtime.native_protocol import NativeLease, NativeOutcome
from fpl_runtime.tools_native import OPEN_LIBRARY

from .receipts import ReceiptStore
from .transport import LeaseEnded, NativeTransport, ProtocolConflict

logger = logging.getLogger(__name__)


def reveal_library(root, owner, *, launch=subprocess.Popen):
    try:
        owner_id = str(UUID(owner))
    except (ValueError, TypeError, AttributeError):
        return {"error": "library_folder_missing"}
    if owner != owner_id:
        return {"error": "library_folder_missing"}
    path = root
    for segment in ("accounts", owner_id, "library", "assets"):
        path = path / segment
        if path.is_symlink() or not path.is_dir():
            return {"error": "library_folder_missing"}
    if not path.resolve().is_relative_to(root):
        return {"error": "library_folder_missing"}
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


class ToolsWorker:
    def __init__(self, transport, assets_root, state_root, *, reveal=reveal_library):
        if assets_root.is_symlink() or not assets_root.is_dir():
            raise ValueError("Tools worker 必须指定真实的 Assets 状态目录")
        self.assets_root = assets_root.resolve()
        self.transport, self.reveal = transport, reveal
        self.receipts = ReceiptStore(state_root / "receipts", retain_acknowledged_payload=False)

    async def deliver(self, lease, outcome):
        error = outcome.result.get("error")
        if outcome.status == "completed" and error in {
            "library_folder_missing",
            "folder_open_unavailable",
            "authorization_revoked",
        }:
            outcome = NativeOutcome(status="failed", error_code=error)
        response = await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if response.get("acknowledged") is not True:
            raise ProtocolConflict("Tools 回执未确认")
        self.receipts.acknowledge(lease)

    async def execute(self, lease):
        if lease.operation != OPEN_LIBRARY or lease.payload:
            raise ProtocolConflict("Tools 租约超出文件夹打开能力")
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

        def action(_operation, _payload):
            return self.reveal(self.assets_root, lease.owner_user_id)

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
            await self.deliver(lease, await self.execute(lease))

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
