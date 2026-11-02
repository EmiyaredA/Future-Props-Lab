"""Outbound-only Mac management worker with durable, non-repeating execution receipts."""

import asyncio
import contextlib
import logging

import httpx

from fpl_runtime.native_protocol import NativeLease, NativeOutcome

from .receipts import ReceiptStore
from .transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


class ManagementWorker:
    def __init__(self, transport, control, state_root):
        self.transport, self.control = transport, control
        self.receipts = ReceiptStore(
            state_root / "receipts", readonly_operations={"management.logs"}
        )

    async def deliver(self, lease, outcome):
        await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        self.receipts.acknowledge(lease)

    async def execute(self, lease):
        async def authorize():
            result = await self.transport.post(
                "authorize", {"lease": lease.model_dump(mode="json")}
            )
            if result.get("active") is not True:
                raise LeaseEnded("管理授权已撤销")

        await authorize()
        loop = asyncio.get_running_loop()

        def action(operation, payload):
            return asyncio.run_coroutine_threadsafe(
                self.control.execute(operation, payload["arguments"], authorize), loop
            ).result()

        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                await self.transport.post("heartbeat", {"lease": lease.model_dump(mode="json")})

        task = asyncio.create_task(heartbeat())
        try:
            return await asyncio.to_thread(self.receipts.execute, lease, action)
        finally:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError, httpx.HTTPError, LeaseEnded):
                await task

    async def observe(self):
        while True:
            try:
                await self.transport.post("report", await self.control.supervise())
            except (
                httpx.HTTPError,
                OSError,
                RuntimeError,
                ValueError,
                LeaseEnded,
                ProtocolConflict,
            ):
                logger.warning("本机运行状态暂不可报告，管理端保留最后观测时间")
            await asyncio.sleep(2)

    async def run(self):
        observer = asyncio.create_task(self.observe())
        try:
            while True:
                try:
                    # An existing intent without an outcome becomes unknown, never re-executed.
                    for lease, stored in self.receipts.pending():
                        if stored is None:
                            outcome = await asyncio.to_thread(
                                self.receipts.execute, lease, lambda *_args: None
                            )
                        else:
                            outcome = NativeOutcome.model_validate(stored)
                        await self.deliver(lease, outcome)
                    result = await self.transport.post("claim", {"wait_seconds": 1})
                    if result.get("lease"):
                        lease = NativeLease.model_validate(result["lease"])
                        try:
                            outcome = await self.execute(lease)
                        except LeaseEnded:
                            outcome = NativeOutcome(
                                status="failed", error_code="authorization_revoked"
                            )
                        await self.deliver(lease, outcome)
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(2)
                except (LeaseEnded, ProtocolConflict):
                    logger.error("管理 worker 凭据或回执被拒绝，请在本机核查")
                    await asyncio.sleep(5)
        finally:
            observer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await observer
            for tunnel in self.control.tunnels.values():
                await tunnel.close()
            await self.transport.close()
