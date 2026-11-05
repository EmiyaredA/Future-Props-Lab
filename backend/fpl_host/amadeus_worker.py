"""Run exact Amadeus actions from the dedicated Mac loopback worker channel."""

import argparse
import asyncio
import logging
import os
import stat
import subprocess
from pathlib import Path
from time import monotonic
from uuid import UUID

import httpx

from app.console.amadeus.files import work_root
from app.console.amadeus.scripts import run_script, sandbox_available
from app.runtime.operation_receipts import OperationError
from fpl_runtime.amadeus_native import FINDER, SCRIPT, FinderScope, ScriptScope
from fpl_runtime.locking import service_lock
from fpl_runtime.native_protocol import NativeLease, NativeOutcome

from .receipts import ReceiptStore
from .transport import LeaseEnded, NativeTransport, ProtocolConflict

logger = logging.getLogger(__name__)


class AmadeusWorker:
    def __init__(
        self,
        transport,
        amadeus_root,
        state_root,
        *,
        launch=subprocess.Popen,
        probe=sandbox_available,
        script=run_script,
    ):
        if amadeus_root.is_symlink() or not amadeus_root.is_dir():
            raise ValueError("Amadeus worker 需要真实的所属服务状态目录")
        self.transport, self.amadeus_root = transport, amadeus_root.resolve()
        if state_root.resolve().is_relative_to(self.amadeus_root):
            raise ValueError("Amadeus worker 回执应与服务文件隔离")
        self.launch, self.probe, self.script_executor = launch, probe, script
        self.last_probe, self.sandbox = float("-inf"), False
        self.receipts = ReceiptStore(state_root / "receipts", retain_acknowledged_payload=False)

    async def execute(self, lease):
        if lease.operation == SCRIPT:
            return await self.script(lease)
        if lease.operation != FINDER:
            raise ProtocolConflict("Amadeus 租约超出原生能力")
        try:
            owner = str(UUID(lease.owner_user_id))
            if owner != lease.owner_user_id:
                raise ValueError("invalid account ID")
            scope = FinderScope.model_validate(lease.payload)
            root = work_root(owner, str(scope.conversation_id), files_root=self.amadeus_root)
            if not root.is_dir() or root.resolve() != root:
                return NativeOutcome(status="failed", error_code="folder_missing")
        except (OperationError, OSError, ValueError):
            return NativeOutcome(status="failed", error_code="folder_missing")
        try:
            confirmation = await self.transport.post(
                "authorize", {"lease": lease.model_dump(mode="json")}
            )
            if confirmation.get("active") is not True:
                raise LeaseEnded("会话授权已失效")
        except LeaseEnded:
            return NativeOutcome(status="failed", error_code="authorization_revoked")
        try:
            self.launch(
                ["/usr/bin/open", str(root)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                close_fds=True,
            )
        except OSError:
            return NativeOutcome(status="failed", error_code="folder_open_unavailable")
        return NativeOutcome(status="completed", result={"opened": True})

    async def script(self, lease):
        if not self.sandbox:
            return NativeOutcome(status="failed", error_code="sandbox_unavailable")
        body = {"lease": lease.model_dump(mode="json")}
        try:
            scope = ScriptScope.model_validate(lease.payload)
            owner = str(UUID(lease.owner_user_id))
            if owner != lease.owner_user_id:
                raise ValueError("invalid owner")
            confirmation = await self.transport.post("authorize", body)
            if confirmation.get("active") is not True:
                raise LeaseEnded("沙箱脚本授权已失效")
        except LeaseEnded:
            return NativeOutcome(status="failed", error_code="authorization_revoked")
        except ValueError:
            return NativeOutcome(status="failed", error_code="invalid_script")

        async def stream(text):
            reply = await self.transport.post("output", {**body, "text": text})
            if reply.get("accepted") is not True:
                raise LeaseEnded("脚本输出授权已失效")

        async def watch():
            while True:
                await asyncio.sleep(1)
                pulse = await self.transport.post("heartbeat", body)
                if pulse.get("active") is not True:
                    raise LeaseEnded("沙箱脚本授权已失效")

        task = asyncio.create_task(
            self.script_executor(
                owner,
                str(scope.conversation_id),
                scope.script.model_dump(mode="json"),
                stream,
                files_root=self.amadeus_root,
            )
        )
        watcher = asyncio.create_task(watch())
        try:
            done, _ = await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                await watcher
            return NativeOutcome(status="completed", result=await task)
        except OperationError as exc:
            return NativeOutcome(status="failed", error_code=exc.code, message=str(exc)[:1000])
        except (OSError, TimeoutError, httpx.HTTPError, LeaseEnded, ProtocolConflict):
            return NativeOutcome(status="unknown", error_code="script_outcome_unconfirmed")
        finally:
            task.cancel()
            watcher.cancel()
            await asyncio.gather(task, watcher, return_exceptions=True)

    async def deliver(self, lease, outcome):
        response = await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        if response.get("acknowledged") is not True:
            raise ProtocolConflict("Amadeus 回执未确认")
        await asyncio.to_thread(self.receipts.acknowledge, lease)

    async def poll_once(self):
        if monotonic() - self.last_probe > 15:
            self.sandbox = await asyncio.to_thread(self.probe)
            self.last_probe = monotonic()
        for lease, stored in self.receipts.pending():
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await self.receipts.execute_async(lease, self.execute)
            )
            await self.deliver(lease, outcome)
        reply = await self.transport.post(
            "claim", {"wait_seconds": 1, "sandbox_available": self.sandbox}
        )
        if reply.get("lease") is not None:
            lease = NativeLease.model_validate(reply["lease"])
            await self.deliver(lease, await self.receipts.execute_async(lease, self.execute))

    async def run(self):
        try:
            while True:
                try:
                    await self.poll_once()
                except (httpx.HTTPError, OSError, LeaseEnded, ProtocolConflict):
                    logger.warning("Amadeus 原生连接或回执未确认")
                    await asyncio.sleep(2)
        finally:
            await self.transport.close()


def main():
    parser = argparse.ArgumentParser(description="FPL Mac Amadeus worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--amadeus-root", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    args = parser.parse_args()
    info = args.worker_token.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        parser.error("Amadeus worker 凭据必须为当前用户独占的普通文件")
    transport = NativeTransport(
        service="amadeus", base_url=args.bridge, credential=args.worker_token.read_text().strip()
    )
    with service_lock(args.state_root):
        asyncio.run(AmadeusWorker(transport, args.amadeus_root, args.state_root).run())


if __name__ == "__main__":
    main()
