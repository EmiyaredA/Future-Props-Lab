"""Website action lifecycle over owned records and replaceable effect adapters."""

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress
from typing import Protocol

from studio.contracts.amadeus.conversations import ActionOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.revisions import RevisionConflictError


class ActionRecords(Protocol):
    async def claim(self, action: str) -> ActionOut: ...
    async def read(self, action: str) -> ActionOut: ...
    async def settle(self, action: str, status: str, result: dict) -> ActionOut: ...
    async def cancel_pending(self, run: str) -> list[str]: ...


Effect = Callable[[ActionOut], Awaitable[dict]]
Scope = tuple[str, str]


async def finish_write(task: asyncio.Task[ActionOut]) -> tuple[ActionOut, bool]:
    """Wait for a durable transition before propagating caller cancellation."""
    interrupted = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            interrupted = True
    return task.result(), interrupted


class ActionExecution:
    """Track in-process work until its durable settlement has finished."""

    def __init__(self):
        self.running: dict[tuple[str, str, str], asyncio.Task] = {}

    async def close(self):
        tasks = tuple(self.running.values())
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def execute(
        self, scope: Scope, action_id: str, records: ActionRecords, effect: Effect
    ) -> ActionOut:
        key = (*scope, action_id)
        if key in self.running:
            raise OperationError("操作已经开始", "approval_conflict", 409)
        self.running[key] = asyncio.current_task()
        try:
            action, interrupted = await finish_write(asyncio.create_task(records.claim(action_id)))
            name, args = action.tool_name, action.arguments
            try:
                if interrupted:
                    raise asyncio.CancelledError
                result = await effect(action)
                status = (
                    "failed" if name == "run_script" and result["exit_code"] != 0 else "completed"
                )
            except asyncio.CancelledError:
                status = "cancelled" if name == "run_script" else "unknown"
                result = {
                    "message": "脚本已停止"
                    if name == "run_script"
                    else "执行中断；请检查外部服务实际状态"
                }
                raise
            except RevisionConflictError as exc:
                status = "failed"
                result = {
                    "code": "revision_conflict",
                    "message": "资源版本冲突，未覆盖现有数据",
                    "current": exc.snapshot,
                }
                if name == "video_timeline_batch":
                    result["operationResults"] = [
                        {
                            "index": index + 1,
                            "type": operation.get("type"),
                            "status": "not_executed",
                        }
                        for index, operation in enumerate(args.get("operations", []))
                        if isinstance(operation, dict)
                    ]
            except OperationError as exc:
                status = "failed"
                result = {"code": getattr(exc, "code", "execution_failed"), "message": str(exc)}
            except Exception:
                status = "failed"
                result = {"message": "工具执行失败；请检查配置或连接状态"}
            finally:
                # Settlement uses its own session. Keep the running handle until
                # the result is durable, including when an HTTP stream disconnects.
                settled, interrupted = await finish_write(
                    asyncio.create_task(records.settle(action_id, status, result))
                )
            if interrupted:
                raise asyncio.CancelledError
            return settled
        finally:
            self.running.pop(key, None)

    async def cancel(self, scope: Scope, action: str, records: ActionRecords) -> ActionOut:
        if (await records.read(action)).status != "running":
            raise OperationError("操作当前没有运行", "action_not_running", 409)
        task = self.running.get((*scope, action))
        if task is None:
            return await records.settle(
                action, "unknown", {"message": "执行进程已结束，结果待核实"}
            )
        if not task.cancelling():
            task.cancel()
        with suppress(asyncio.CancelledError):
            await asyncio.shield(task)
        return await records.read(action)

    async def cancel_for_run(self, scope: Scope, run: str, records: ActionRecords) -> None:
        for action in await records.cancel_pending(run):
            task = self.running.get((*scope, action))
            if task is None:
                await records.settle(action, "unknown", {"message": "执行进程不可用，结果待核实"})
            elif not task.cancelling():
                task.cancel()
