"""One-shot execution of actions approved against their exact arguments."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select, update

from studio.apps.amadeus.clients.website_operations import call_operation
from studio.apps.amadeus.storage.files import write_file
from studio.apps.amadeus.storage.models import AmadeusAction, AmadeusConversation, AmadeusRun
from studio.apps.integrations.transport.bindings import mcp_catalog, tool_catalog
from studio.contracts.amadeus.conversations import ActionOut
from studio.host.agent_execution.amadeus_scripts import run_script
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.revisions import RevisionConflictError
from studio.runtime.time import utc_now

VideoExecutor = Callable[[str, str, str, dict[str, Any]], Awaitable[dict[str, Any]]]


@dataclass
class ActionExecution:
    """Process-owned handles; persisted action records remain the source of truth.

    Shutdown cancels active operations and waits for their final settlement before
    the owning database closes. Non-script cancellation keeps an unknown result.
    """

    video: VideoExecutor
    files_root: Path
    resolve_agent: Callable
    running: dict[str, asyncio.Task] = field(default_factory=dict)

    async def close(self):
        tasks = tuple(self.running.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)


def _out(row: AmadeusAction) -> ActionOut:
    return ActionOut(
        id=row.id,
        tool_name=row.tool_name,
        arguments=row.arguments_json,
        arguments_sha256=row.arguments_sha256,
        status=row.status,
        result=row.result_json,
        run_id=row.run_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def execute_action(
    session,
    principal,
    conversation_id: str,
    action_id: str,
    request,
    output_callback: Callable[[str], None] | None = None,
    *,
    execution: ActionExecution,
) -> ActionOut:
    owner = await session.scalar(
        select(AmadeusConversation).where(
            AmadeusConversation.id == conversation_id,
            AmadeusConversation.owner_user_id == principal.owner_user_id,
            AmadeusConversation.user_id == principal.user_id,
        )
    )
    if owner is None:
        raise OperationError("对话不存在", "not_found", 404)
    if owner.executor_kind == "legacy-pi":
        raise OperationError("旧内核对话只读", "legacy_readonly", 409)
    row = await session.scalar(
        select(AmadeusAction).where(
            AmadeusAction.id == action_id,
            AmadeusAction.conversation_id == conversation_id,
            AmadeusAction.owner_user_id == principal.owner_user_id,
            AmadeusAction.user_id == principal.user_id,
        )
    )
    if row is None:
        raise OperationError("操作不存在", "not_found", 404)
    if row.status != "approved":
        raise OperationError("操作未获批准或已经执行", "approval_conflict", 409)
    if row.run_id:
        source_run = await session.get(AmadeusRun, row.run_id)
        if source_run and source_run.agent_id:
            await execution.resolve_agent(
                session,
                principal.owner_user_id,
                principal.user_id,
                source_run.agent_id,
                probe=False,
            )
        active = await session.scalar(
            select(AmadeusRun.id).where(
                AmadeusRun.id == row.run_id,
                AmadeusRun.owner_user_id == principal.owner_user_id,
                AmadeusRun.user_id == principal.user_id,
                AmadeusRun.status.in_(("running", "waiting_approval")),
            )
        )
        if active is None:
            raise OperationError("运行已经结束，操作不可执行", "run_not_active", 409)
    name, args = row.tool_name, row.arguments_json
    built_in = {"write_work_file", "write_script", "run_script", "video_timeline_batch"}
    if not name.startswith(("tool_api:", "mcp:", "fpl_operation:")) and name not in built_in:
        raise OperationError("工具不可执行", "unsupported_tool", 422)
    if name.startswith(("tool_api:", "mcp:")) and not principal.allows("configuration.manage"):
        raise OperationError("没有外部工具执行权限", "insufficient_permission", 403)
    if (name in built_in or name.startswith("fpl_operation:")) and not principal.allows(
        "content.write"
    ):
        raise OperationError("没有脚本执行权限", "insufficient_permission", 403)
    claimed = await session.execute(
        update(AmadeusAction)
        .where(AmadeusAction.id == row.id, AmadeusAction.status == "approved")
        .values(status="running", updated_at=utc_now())
    )
    if claimed.rowcount != 1:
        raise OperationError("操作已经开始", "approval_conflict", 409)
    await session.commit()
    task = asyncio.current_task()
    if task is not None:
        execution.running[action_id] = task
    try:
        if name.startswith("tool_api:"):
            result = await tool_catalog(request, session, principal.owner_user_id).execute(
                name.removeprefix("tool_api:"), args.get("input", {}), args["revision"]
            )
        elif name.startswith("mcp:"):
            parts = name.split(":", 2)
            if len(parts) != 3:
                raise ValueError("MCP 工具名无效")
            result = await mcp_catalog(request, session, principal.owner_user_id).execute(
                parts[1], parts[2], args.get("input", {}), args["revision"]
            )
        elif name in {"write_script", "write_work_file"}:
            filename = str(args.get("name", ""))
            content = args.get("content")
            if not isinstance(content, str):
                raise ValueError("脚本内容无效")
            result = write_file(
                principal.owner_user_id,
                conversation_id,
                "scripts" if name == "write_script" else "outputs",
                filename,
                content.encode(),
                str(args.get("expected_sha256", "")),
                files_root=execution.files_root,
            )
        elif name == "video_timeline_batch":
            result = await execution.video(
                principal.owner_user_id, row.id, str(args.get("project_id", "")), args
            )
        elif name.startswith("fpl_operation:"):
            result = await call_operation(
                request.app,
                request.headers,
                name.removeprefix("fpl_operation:"),
                args,
                allow_write=True,
            )
        else:
            result = await run_script(
                principal.owner_user_id,
                conversation_id,
                args,
                output_callback,
                files_root=execution.files_root,
            )
        status = "failed" if name == "run_script" and result["exit_code"] != 0 else "completed"
    except asyncio.CancelledError:
        status = "cancelled" if name == "run_script" else "unknown"
        result = {
            "message": "脚本已停止" if name == "run_script" else "执行中断；请检查外部服务实际状态"
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
                {"index": index + 1, "type": operation.get("type"), "status": "not_executed"}
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
        execution.running.pop(action_id, None)
        row = await session.scalar(select(AmadeusAction).where(AmadeusAction.id == action_id))
        row.status = status
        row.result_json = result
        row.updated_at = utc_now()
        await asyncio.shield(session.commit())
    return _out(row)


async def cancel_action(
    session, principal, conversation_id: str, action_id: str, *, execution: ActionExecution
) -> ActionOut:
    owner = await session.scalar(
        select(AmadeusConversation.id).where(
            AmadeusConversation.id == conversation_id,
            AmadeusConversation.owner_user_id == principal.owner_user_id,
            AmadeusConversation.user_id == principal.user_id,
        )
    )
    if owner is None:
        raise OperationError("对话不存在", "not_found", 404)
    row = await session.scalar(
        select(AmadeusAction).where(
            AmadeusAction.id == action_id,
            AmadeusAction.conversation_id == conversation_id,
            AmadeusAction.owner_user_id == principal.owner_user_id,
            AmadeusAction.user_id == principal.user_id,
        )
    )
    if row is None:
        raise OperationError("操作不存在", "not_found", 404)
    if row.status != "running":
        raise OperationError("操作当前没有运行", "action_not_running", 409)
    task = execution.running.get(action_id)
    if task is None:
        row.status = "unknown"
        row.result_json = {"message": "执行进程已结束，结果待核实"}
        row.updated_at = utc_now()
        await session.commit()
        return _out(row)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    await session.refresh(row)
    return _out(row)


async def cancel_actions_for_run(
    session, principal, run_id: str, *, execution: ActionExecution
) -> None:
    """Invalidate pending approvals and stop process-owned work for one run."""
    rows = (
        await session.scalars(
            select(AmadeusAction).where(
                AmadeusAction.run_id == run_id,
                AmadeusAction.owner_user_id == principal.owner_user_id,
                AmadeusAction.user_id == principal.user_id,
                AmadeusAction.status.in_(("pending", "approved", "running")),
            )
        )
    ).all()
    now = utc_now()
    for row in rows:
        if row.status == "running":
            task = execution.running.get(row.id)
            if task is not None:
                task.cancel()
            else:
                row.status = "unknown"
                row.result_json = {"message": "执行进程不可用，结果待核实"}
                row.updated_at = now
        else:
            row.status = "cancelled"
            row.result_json = {"message": "运行已停止，操作未执行"}
            row.updated_at = now
    await session.commit()
