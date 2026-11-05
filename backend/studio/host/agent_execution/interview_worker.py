"""Run only FPL-owned preparation leases using the Mac's registered Codex CLI."""

import argparse
import asyncio
import base64
import os
import shutil
import stat
from contextlib import suppress
from pathlib import Path
from types import SimpleNamespace

import httpx
from pydantic import ValidationError

from app.capabilities.agents.cli.catalog import inspect_connection
from app.runtime.config import get_settings
from app.runtime.operation_receipts import OperationError
from studio.apps.interview_assistant.bundles import acceptance
from studio.apps.interview_assistant.codex import CodexExecutor, executable, frozen_context
from studio.contracts.agent_workbench.native import NativeLease, NativeOutcome
from studio.contracts.interview_assistant.documents import PreparationBundle
from studio.contracts.interview_assistant.execution import (
    OPERATION,
    ExecutionEvent,
    ExecutionInput,
    WorkerStatus,
)
from studio.host.receipts import ReceiptStore
from studio.host.transport import LeaseEnded, NativeTransport, ProtocolConflict
from studio.runtime.lifecycle.locking import service_lock

UNAVAILABLE = WorkerStatus(available=False, code="executor_unavailable")


async def check_codex():
    try:
        executable()
        status = await inspect_connection(
            get_settings(), "codex", discover_models=False, app_server=False
        )
        if status["available"]:
            return WorkerStatus(available=True, code="ready", version=status["version"])
    except (OperationError, ValidationError, OSError):
        pass
    return UNAVAILABLE


class InterviewWorker:
    def __init__(self, transport, state_root, *, executor=None, probe=check_codex):
        self.transport, self.probe = transport, probe
        self.executor = executor if executor is not None else CodexExecutor()
        self.receipts = ReceiptStore(state_root / "receipts", retain_acknowledged_payload=False)
        self.attempts = state_root / "attempts"
        if self.attempts.is_symlink():
            raise ValueError("面试任务目录不能是符号链接")
        self.attempts.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.attempts.chmod(0o700)
        self.status = UNAVAILABLE

    def clean(self, lease):
        path = self.attempts / str(lease.job_id)
        if path.is_symlink():
            raise ValueError("面试任务目录不能是符号链接")
        if path.exists():
            shutil.rmtree(path)

    async def run_task(self, lease, body):
        if not (await self.probe()).available:
            return {"failed": "executor_unavailable", "message": "本机 Codex 暂不可用"}
        supplied = lease.model_dump(mode="json")

        async def active():
            try:
                result = await self.transport.post("active", {"lease": supplied})
                return result.get("active") is True
            except LeaseEnded:
                return False

        async def event(kind, message, urls=None):
            output = ExecutionEvent(kind=kind, message=message[:500], urls=(urls or [])[:20])
            result = await self.transport.post(
                "event", {"lease": supplied, "event": output.model_dump(mode="json")}
            )
            if result.get("accepted") is not True:
                raise ProtocolConflict("面试进度未确认")

        try:
            if not await active():
                return {"failed": "task_cancelled", "message": "任务已取消或授权已变化"}
            response = await self.transport.post("material", {"lease": supplied})
            source = response["bytes"]
            original = base64.b64decode(source, validate=True) if source is not None else None
            task = SimpleNamespace(
                id=str(body.id), input_hash=body.input_hash, snapshot=body.snapshot.model_dump()
            )
            root = await asyncio.to_thread(
                frozen_context, self.attempts / str(lease.job_id), task.snapshot, original
            )
            await event("started", "已冻结 JD、简历原件与补充说明，正在交给 Codex")
            document, searches = await self.executor.run(task, root, event, active)
            await event("validating", "正在校验交付格式、原文依据和资料引用")
            bundle = PreparationBundle.model_validate(document)
            if (bundle.task_id, bundle.input_hash) != (task.id, task.input_hash):
                return {"failed": "invalid_delivery", "message": "交付与本次输入快照不一致"}
            problems = acceptance(bundle, task.id, task.input_hash, root, searches)
            if not problems:
                await event("accepted", "资料结构验收通过", [item.url for item in bundle.sources])
            return {
                "state": "needs_input" if problems else "succeeded",
                "message": ("；".join(problems) if problems else "本场资料已准备完成")[:1000],
                "bundle": bundle.model_dump(mode="json"),
            }
        except LeaseEnded:
            return {"failed": "task_cancelled", "message": "任务已取消或授权已变化"}
        except ValidationError:
            return {"failed": "invalid_delivery", "message": "交付格式不合格，请重新准备"}
        except OperationError as exc:
            return {"failed": exc.code, "message": str(exc)[:1000]}

    async def execute(self, lease):
        if lease.operation != OPERATION:
            raise ProtocolConflict("未登记的面试任务类型")
        body = ExecutionInput.model_validate(lease.payload)
        if body.id != lease.job_id:
            raise ProtocolConflict("面试任务标识不一致")
        loop = asyncio.get_running_loop()

        def run(_operation, _payload):
            return asyncio.run_coroutine_threadsafe(self.run_task(lease, body), loop).result()

        try:
            return await asyncio.to_thread(self.receipts.execute, lease, run)
        finally:
            await asyncio.to_thread(self.clean, lease)

    async def deliver(self, lease, outcome):
        if outcome.status == "completed" and outcome.result.get("failed"):
            outcome = NativeOutcome(
                status="failed",
                error_code=outcome.result["failed"],
                message=outcome.result["message"],
            )
        try:
            result = await self.transport.post(
                "receipt",
                {
                    "lease": lease.model_dump(mode="json"),
                    "outcome": outcome.model_dump(mode="json"),
                },
            )
            if result.get("acknowledged") is not True:
                raise ProtocolConflict("面试回执未确认")
        except LeaseEnded:
            # Deleted rooms no longer accept a result. No new execution is attempted.
            pass
        self.receipts.acknowledge(lease)
        await asyncio.to_thread(self.clean, lease)

    async def poll_once(self):
        for lease, stored in self.receipts.pending():
            outcome = (
                NativeOutcome.model_validate(stored)
                if stored is not None
                else await asyncio.to_thread(self.receipts.execute, lease, lambda *_: None)
            )
            await self.deliver(lease, outcome)
        response = await self.transport.post("claim", self.status.model_dump(mode="json"))
        if response.get("lease") is not None:
            lease = NativeLease.model_validate(response["lease"])
            await self.deliver(lease, await self.execute(lease))

    async def heartbeat(self):
        while True:
            try:
                self.status = await self.probe()
                await self.transport.post("beat", self.status.model_dump(mode="json"))
            except (httpx.HTTPError, OSError, LeaseEnded, ProtocolConflict):
                self.status = UNAVAILABLE
            await asyncio.sleep(5)

    async def run(self):
        pulse = asyncio.create_task(self.heartbeat())
        try:
            while True:
                try:
                    await self.poll_once()
                except (httpx.HTTPError, OSError, LeaseEnded, ProtocolConflict):
                    await asyncio.sleep(2)
                await asyncio.sleep(0.7)
        finally:
            pulse.cancel()
            with suppress(asyncio.CancelledError):
                await pulse
            await self.transport.close()


def main():
    parser = argparse.ArgumentParser(description="FPL Mac Interview worker")
    parser.add_argument("--bridge", required=True)
    parser.add_argument("--worker-token", required=True, type=Path)
    parser.add_argument("--state-root", required=True, type=Path)
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    try:
        for path in (args.worker_token, args.config):
            info = path.lstat()
            if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
                raise ValueError
        credential = args.worker_token.read_text().strip()
        bridge = NativeTransport(base_url=args.bridge, credential=credential, service="interview")
    except (OSError, ValueError):
        parser.error("Interview 配置和 worker 凭据须为当前用户独占的普通文件")
    os.environ["FPL_CONFIG_FILE"] = str(args.config.resolve())
    with service_lock(args.state_root):
        asyncio.run(InterviewWorker(bridge, args.state_root.resolve()).run())


if __name__ == "__main__":
    main()
