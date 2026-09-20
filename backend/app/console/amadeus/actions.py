"""One-shot execution of actions approved against their exact arguments."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from sqlalchemy import select, update

from app.console.amadeus.files import write_file
from app.console.amadeus.fpl_operations import call_operation
from app.console.amadeus.models import AmadeusAction, AmadeusConversation
from app.console.amadeus.schemas import ActionOut
from app.console.amadeus.scripts import run_script
from app.integrations.mcp.catalog import McpCatalog
from app.integrations.tool_apis.catalog import ToolApiCatalog
from app.runtime.operation_receipts import OperationError
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now

VideoExecutor = Callable[[str, str, str, dict[str, Any]], Awaitable[dict[str, Any]]]
_video_executor: VideoExecutor | None = None
_running_tasks: dict[str, asyncio.Task] = {}


def register_video_executor(executor: VideoExecutor) -> None:
    """Installed once by API composition; console does not depend on an App package."""
    global _video_executor
    _video_executor = executor


def _out(row: AmadeusAction) -> ActionOut:
    return ActionOut(
        id=row.id,
        tool_name=row.tool_name,
        arguments=row.arguments_json,
        arguments_sha256=row.arguments_sha256,
        status=row.status,
        result=row.result_json,
        created_at=row.created_at,
    )


async def execute_action(
    session,
    principal,
    conversation_id: str,
    action_id: str,
    request,
    output_callback: Callable[[str], None] | None = None,
) -> ActionOut:
    owner = await session.scalar(
        select(AmadeusConversation).where(
            AmadeusConversation.id == conversation_id,
            AmadeusConversation.workspace_id == principal.workspace_id,
            AmadeusConversation.user_id == principal.user_id,
        )
    )
    if owner is None:
        raise OperationError("对话不存在", "not_found", 404)
    row = await session.scalar(
        select(AmadeusAction).where(
            AmadeusAction.id == action_id,
            AmadeusAction.conversation_id == conversation_id,
            AmadeusAction.workspace_id == principal.workspace_id,
            AmadeusAction.user_id == principal.user_id,
        )
    )
    if row is None:
        raise OperationError("操作不存在", "not_found", 404)
    if row.status != "approved":
        raise OperationError("操作未获批准或已经执行", "approval_conflict", 409)
    name, args = row.tool_name, row.arguments_json
    built_in = {"write_script", "run_script", "video_timeline_batch"}
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
        _running_tasks[action_id] = task
    try:
        if name.startswith("tool_api:"):
            result = await ToolApiCatalog(session, principal.workspace_id).execute(
                name.removeprefix("tool_api:"), args.get("input", {}), args["revision"]
            )
        elif name.startswith("mcp:"):
            parts = name.split(":", 2)
            if len(parts) != 3:
                raise ValueError("MCP 工具名无效")
            result = await McpCatalog(session, principal.workspace_id).execute(
                parts[1], parts[2], args.get("input", {}), args["revision"]
            )
        elif name == "write_script":
            filename = str(args.get("name", ""))
            content = args.get("content")
            if not isinstance(content, str):
                raise ValueError("脚本内容无效")
            result = write_file(
                principal.workspace_id,
                conversation_id,
                "scripts",
                filename,
                content.encode(),
                str(args.get("expected_sha256", "")),
            )
        elif name == "video_timeline_batch":
            if _video_executor is None:
                raise OperationError("视频工具不可用", "unsupported_tool", 503)
            result = await _video_executor(
                principal.workspace_id, row.id, str(args.get("project_id", "")), args
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
                principal.workspace_id, conversation_id, args, output_callback
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
        _running_tasks.pop(action_id, None)
        row = await session.scalar(select(AmadeusAction).where(AmadeusAction.id == action_id))
        row.status = status
        row.result_json = result
        row.updated_at = utc_now()
        await asyncio.shield(session.commit())
    return _out(row)


async def cancel_action(session, principal, conversation_id: str, action_id: str) -> ActionOut:
    owner = await session.scalar(
        select(AmadeusConversation.id).where(
            AmadeusConversation.id == conversation_id,
            AmadeusConversation.workspace_id == principal.workspace_id,
            AmadeusConversation.user_id == principal.user_id,
        )
    )
    if owner is None:
        raise OperationError("对话不存在", "not_found", 404)
    row = await session.scalar(
        select(AmadeusAction).where(
            AmadeusAction.id == action_id,
            AmadeusAction.conversation_id == conversation_id,
            AmadeusAction.workspace_id == principal.workspace_id,
            AmadeusAction.user_id == principal.user_id,
        )
    )
    if row is None:
        raise OperationError("操作不存在", "not_found", 404)
    if row.status != "running":
        raise OperationError("操作当前没有运行", "action_not_running", 409)
    task = _running_tasks.get(action_id)
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
