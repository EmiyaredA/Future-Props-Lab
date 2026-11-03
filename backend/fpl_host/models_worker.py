"""Outbound Mac model worker: persist execution before side effects, retry only delivery."""

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

from .models_control import ModelsControl
from .models_transport import ModelsTransport
from .receipts import ReceiptStore
from .transport import LeaseEnded, ProtocolConflict

logger = logging.getLogger(__name__)


class ModelsWorker:
    def __init__(self, transport, control, state_root):
        self.transport, self.control = transport, control
        self.receipts = ReceiptStore(state_root / "receipts", retain_acknowledged_payload=False)
        self.running = {}
        self.observations = asyncio.Lock()

    async def report_state(self):
        # Serialize the snapshot and delivery together. An older in-flight report
        # must finish before a command's final state can be acknowledged.
        async with self.observations:
            await self.transport.post("report", await self.control.observe())

    async def deliver(self, lease, outcome):
        if outcome.status == "completed" and outcome.result.get("rejected"):
            outcome = NativeOutcome(status="failed", error_code="authorization_revoked")
        if outcome.status == "completed" and lease.operation == "models.synthesize":
            await self.transport.upload_result(
                lease, self.control.output_path(lease), outcome.result["output"]
            )
        if lease.operation != "models.synthesize":
            # The saved execution outcome is already durable. Report failures can
            # retry delivery without repeating installation or other side effects.
            await self.report_state()
        await self.transport.post(
            "receipt",
            {"lease": lease.model_dump(mode="json"), "outcome": outcome.model_dump(mode="json")},
        )
        self.receipts.acknowledge(lease)
        await self.control.cleanup(lease)

    async def execute(self, lease):
        cancelled = Event()
        action_stopped = asyncio.Event()
        actual_action = None
        executing = None

        def ensure_running():
            if cancelled.is_set():
                raise asyncio.CancelledError()

        async def authorize():
            while True:
                ensure_running()
                try:
                    value = await self.transport.post(
                        "authorize", {"lease": lease.model_dump(mode="json")}
                    )
                    if value.get("active") is not True:
                        raise LeaseEnded("本地模型执行授权已撤销")
                    return
                except httpx.HTTPStatusError as exc:
                    if exc.response.status_code != 503:
                        raise
                except httpx.TransportError:
                    pass
                # Retry only authorization; an unavailable Identity never starts MLX.
                await asyncio.sleep(0.5)

        async def action():
            nonlocal actual_action
            actual_action = asyncio.current_task()
            try:
                ensure_running()
                await authorize()
                if lease.operation == "models.synthesize":
                    target = self.control.scratch(lease) / lease.payload["reference_filename"]
                    await self.transport.download_reference(lease, target)
                ensure_running()
                return await self.control.execute(lease, authorize)
            except LeaseEnded:
                return {"rejected": True}
            finally:
                action_stopped.set()

        loop = asyncio.get_running_loop()

        def recorded(_operation, _payload):
            nonlocal executing
            if cancelled.is_set():
                raise RuntimeError("模型 worker 已在调度前停止")
            executing = asyncio.run_coroutine_threadsafe(action(), loop)
            result = executing.result()
            if cancelled.is_set():
                raise RuntimeError("模型 worker 在执行期间停止，保留未知结果")
            return result

        async def retained(awaitable):
            waiting = asyncio.ensure_future(awaitable)
            while not waiting.done():
                try:
                    await asyncio.shield(waiting)
                except asyncio.CancelledError:
                    # Repeated stop requests cannot release the host lock while
                    # a receipt thread or the actual action is still unwinding.
                    continue
            return waiting.result()

        async def heartbeat():
            while True:
                await asyncio.sleep(15)
                await self.transport.post("heartbeat", {"lease": lease.model_dump(mode="json")})

        heartbeat_task = asyncio.create_task(heartbeat())
        recording = asyncio.create_task(asyncio.to_thread(self.receipts.execute, lease, recorded))
        try:
            return await asyncio.shield(recording)
        except asyncio.CancelledError:
            cancelled.set()
            if executing is not None:
                executing.cancel()
            elif actual_action is not None:
                actual_action.cancel()
            try:
                await retained(recording)
            finally:
                # concurrent Future.cancel() can finish the receipt thread before
                # the asyncio action has finished its SDK/model cleanup.
                if actual_action is not None:
                    await retained(action_stopped.wait())
            raise
        finally:
            heartbeat_task.cancel()
            with contextlib.suppress(
                asyncio.CancelledError, httpx.HTTPError, LeaseEnded, ProtocolConflict
            ):
                await heartbeat_task

    async def work(self, lease):
        try:
            outcome = await self.execute(lease)
            await self.deliver(lease, outcome)
        finally:
            self.running.pop(str(lease.job_id), None)

    async def observe(self):
        while True:
            try:
                await self.report_state()
            except (httpx.HTTPError, OSError, ValueError, RuntimeError):
                logger.warning("原生模型状态暂不可报告")
            await asyncio.sleep(2)

    async def run(self):
        observer = asyncio.create_task(self.observe())
        try:
            while True:
                try:
                    for lease, stored in self.receipts.pending():
                        if str(lease.job_id) in self.running:
                            continue
                        outcome = (
                            NativeOutcome.model_validate(stored)
                            if stored is not None
                            else await asyncio.to_thread(
                                self.receipts.execute, lease, lambda *_args: None
                            )
                        )
                        await self.deliver(lease, outcome)
                    if len(self.running) < 4:
                        result = await self.transport.post("claim", {"wait_seconds": 1})
                        if result.get("lease"):
                            lease = NativeLease.model_validate(result["lease"])
                            task = asyncio.create_task(self.work(lease))
                            self.running[str(lease.job_id)] = task
                            task.add_done_callback(self.finished)
                    await asyncio.sleep(0.1)
                except (httpx.HTTPError, OSError):
                    await asyncio.sleep(2)
                except (LeaseEnded, ProtocolConflict, ValueError):
                    logger.error("原生模型回执或通道被拒绝，请在本机核对")
                    await asyncio.sleep(5)
        finally:
            observer.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await observer
            for task in tuple(self.running.values()):
                task.cancel()
            await asyncio.gather(*self.running.values(), return_exceptions=True)
            await self.control.close()
            await self.transport.close()

    @staticmethod
    def finished(task):
        if not task.cancelled() and task.exception() is not None:
            logger.warning("原生模型交付未确认，保留原回执")


def run():
    parser = argparse.ArgumentParser(description="FPL Mac native model worker")
    parser.add_argument("--connection", type=Path, required=True)
    parser.add_argument("--state-root", type=Path, required=True)
    parser.add_argument("--models-root", type=Path, required=True)
    args = parser.parse_args()
    if args.connection.is_symlink():
        raise ValueError("原生模型连接配置不能是符号链接")
    metadata = args.connection.stat()
    if metadata.st_uid != os.getuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
        raise ValueError("原生模型连接配置必须归当前用户所有且权限不超过0600")
    values = json.loads(args.connection.read_text())
    if set(values) != {"base_url", "credential"}:
        raise ValueError("原生模型连接配置字段无效")
    if args.models_root.is_symlink() or args.state_root.is_symlink():
        raise ValueError("原生模型目录不能是符号链接")
    with service_lock(args.state_root):
        control = ModelsControl(args.state_root.resolve(), args.models_root.resolve())
        asyncio.run(ModelsWorker(ModelsTransport(**values), control, args.state_root).run())


if __name__ == "__main__":
    try:
        run()
    except (ValueError, RuntimeError) as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1) from None
