"""Outbound native MCP worker; unknown executions are never repeated."""

import argparse
import asyncio
import contextlib
import json
import logging
import os
import stat
import sys
from pathlib import Path
from threading import Event

import httpx

from fpl_runtime.locking import service_lock
from fpl_runtime.native_protocol import NativeLease, NativeOutcome

from .mcp_control import McpControl
from .receipts import ReceiptStore
from .transport import LeaseEnded, NativeTransport, ProtocolConflict

logger = logging.getLogger(__name__)


class McpWorker:
    def __init__(self, transport, control, state_root):
        self.transport, self.control = transport, control
        self.receipts = ReceiptStore(state_root / "receipts")

    async def deliver(self, lease, outcome):
        if outcome.status == "completed" and outcome.result == {"not_started": True}:
            outcome = NativeOutcome(status="failed", error_code="authorization_revoked")
        await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        self.receipts.acknowledge(lease)

    async def execute(self, lease):
        body = {"lease": lease.model_dump(mode="json")}
        cancelled = Event()
        action_task = None
        action_finished = asyncio.Event()

        async def dispatch():
            if cancelled.is_set():
                return {"not_started": True}
            try:
                await self.transport.post("authorize", body)
                launch = await self.transport.post("launch", body)
            except LeaseEnded:
                return {"not_started": True}

            async def watch():
                while True:
                    await asyncio.sleep(1)
                    decision = await self.transport.post("authorize", body)
                    if decision.get("active") is not True:
                        raise LeaseEnded("MCP execution authorization was revoked")
                    heartbeat = await self.transport.post("heartbeat", body)
                    if heartbeat.get("active") is not True:
                        raise LeaseEnded("MCP lease ended")

            running = asyncio.create_task(self.control.execute(lease, launch))
            watcher = asyncio.create_task(watch())
            try:
                done, _ = await asyncio.wait(
                    {running, watcher}, return_when=asyncio.FIRST_COMPLETED
                )
                if watcher in done:
                    await watcher
                return await running
            finally:
                running.cancel()
                watcher.cancel()
                await asyncio.gather(running, watcher, return_exceptions=True)

        async def action():
            nonlocal action_task
            action_task = asyncio.current_task()
            try:
                return await dispatch()
            finally:
                # The concurrent Future reports cancellation before this
                # coroutine's SDK/process cleanup actually finishes.
                action_finished.set()

        loop = asyncio.get_running_loop()

        executing = None

        def recorded(_operation, _payload):
            nonlocal executing
            if cancelled.is_set():
                raise RuntimeError("MCP worker stopped before dispatch")
            executing = asyncio.run_coroutine_threadsafe(action(), loop)
            return executing.result()

        recording = asyncio.create_task(asyncio.to_thread(self.receipts.execute, lease, recorded))
        try:
            return await asyncio.shield(recording)
        except asyncio.CancelledError:
            cancelled.set()
            if executing is not None:
                executing.cancel()
            elif action_task is not None:
                action_task.cancel()
            await asyncio.shield(recording)
            if action_task is not None:
                await asyncio.shield(action_finished.wait())
            raise

    async def observe(self):
        while True:
            try:
                await self.transport.post("report", self.control.observe())
            except (httpx.HTTPError, OSError, RuntimeError):
                logger.warning("Native MCP observation temporarily unavailable")
            await asyncio.sleep(2)

    async def run(self):
        observer = asyncio.create_task(self.observe())
        try:
            while True:
                try:
                    for lease, stored in self.receipts.pending():
                        outcome = (
                            NativeOutcome.model_validate(stored)
                            if stored is not None
                            else await asyncio.to_thread(
                                self.receipts.execute, lease, lambda *_args: None
                            )
                        )
                        await self.deliver(lease, outcome)
                    value = await self.transport.post("claim", {"wait_seconds": 1})
                    if value.get("lease"):
                        lease = NativeLease.model_validate(value["lease"])
                        await self.deliver(lease, await self.execute(lease))
                    await asyncio.sleep(0.1)
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(2)
                except (LeaseEnded, ProtocolConflict, ValueError):
                    logger.warning("Native MCP receipt retained for local review")
                    await asyncio.sleep(5)
        finally:
            observer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await observer
            await self.transport.close()


def read_private(path):
    if path.is_symlink():
        raise ValueError("Native MCP configuration cannot be a symlink")
    metadata = path.stat()
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("Native MCP configuration must be owned by current user with mode 0600")
    return json.loads(path.read_text())


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--connection", type=Path, required=True)
    parser.add_argument("--profiles", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    options = parser.parse_args()
    connection, profiles = read_private(options.connection), read_private(options.profiles)
    if set(connection) != {"base_url", "credential"} or not isinstance(profiles, list):
        raise ValueError("Native MCP configuration is invalid")
    if options.state_root.is_symlink():
        raise ValueError("Native MCP state cannot be a symlink")
    with service_lock(options.state_root):
        control = McpControl(profiles, options.state_root)
        transport = NativeTransport(service="integrations", **connection)
        asyncio.run(McpWorker(transport, control, options.state_root).run())


if __name__ == "__main__":
    try:
        run()
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
