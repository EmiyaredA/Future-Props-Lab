"""Execute an approved action once and settle the owned record independently of HTTP."""

import asyncio
from functools import partial

from anyio.to_thread import run_sync

from app.console.amadeus.files import write_file
from app.runtime.operation_receipts import OperationError

from .action_records import WORK_FILES, ActionRecords
from .operation_calls import call_registered

UNKNOWN = {"message": "执行中断，结果待核实"}


class ActionExecution:
    def __init__(self, database, identity, capabilities, locks):
        self.database, self.identity, self.locks = database, identity, locks
        self.capabilities = capabilities
        self.tasks = {}

    def available(self, name):
        return name in WORK_FILES or name.startswith("fpl_operation:")

    async def require_authority(self, assertion, path):
        live = await self.identity.status(assertion=assertion, method="POST", path=path)
        if live is not True:
            raise OperationError(
                "原操作授权不可用", "action_authorization_ended", 503 if live is None else 403
            )

    async def start(self, principal, conversation, action, *, assertion, path):
        await self.require_authority(assertion, path)
        key = principal.user_id, conversation, action
        lock = self.locks.setdefault(key[:2], asyncio.Lock())
        async with lock:
            if len(self.tasks) >= 64:
                raise OperationError("操作执行器繁忙", "action_unavailable", 503)
            async with self.database.sessions(info={"owner_user_id": principal.user_id}) as session:
                records = ActionRecords(session, principal, conversation)
                approved = await records.claim(action, self.available)
            task = asyncio.create_task(
                self.execute(principal, conversation, approved, assertion, path),
                name=f"amadeus-action:{action}",
            )
            self.tasks[key] = task
            task.add_done_callback(lambda _result: self.tasks.pop(key, None))
        return task

    async def execute(self, principal, conversation, approved, assertion, path):
        try:
            await self.require_authority(assertion, path)
            if approved.tool_name.startswith("fpl_operation:"):
                result = await call_registered(
                    self.capabilities,
                    assertion,
                    path,
                    approved.tool_name.removeprefix("fpl_operation:"),
                    approved.arguments,
                    approved=True,
                )
            else:
                result = await self.write_file(principal, conversation, approved)
            status = "completed"
        except asyncio.CancelledError:
            status, result = "unknown", UNKNOWN
        except OperationError as exc:
            status = "unknown" if exc.code == "operation_unconfirmed" else "failed"
            result = {"code": exc.code, "message": str(exc)}
        except (OSError, ValueError):
            status, result = "unknown", UNKNOWN
        async with self.database.sessions(info={"owner_user_id": principal.user_id}) as session:
            return await ActionRecords(session, principal, conversation).settle(
                approved.id, status, result
            )

    async def write_file(self, principal, conversation, approved):
        args = approved.arguments
        content = args.get("content")
        if not isinstance(content, str):
            raise OperationError("脚本内容无效", "invalid_arguments")
        kind = "scripts" if approved.tool_name == "write_script" else "outputs"
        return await run_sync(
            partial(
                write_file,
                principal.user_id,
                conversation,
                kind,
                str(args.get("name", "")),
                content.encode(),
                str(args.get("expected_sha256", "")),
                files_root=self.database.root,
            )
        )

    async def cancel(self, principal, conversation, action, *, assertion, path):
        await self.require_authority(assertion, path)
        key = principal.user_id, conversation, action
        async with self.database.sessions(info={"owner_user_id": principal.user_id}) as session:
            records = ActionRecords(session, principal, conversation)
            row = await records.get(action)
            if row.status != "running":
                raise OperationError("操作当前没有运行", "action_not_running", 409)
            await session.rollback()
            task = self.tasks.get(key)
            if task is not None:
                if not task.cancelling():
                    task.cancel()
                try:
                    return await asyncio.shield(task)
                except asyncio.CancelledError:
                    if not task.cancelled():
                        raise
            return await records.settle(action, "unknown", UNKNOWN)

    async def close(self):
        tasks = tuple(self.tasks.values())
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
