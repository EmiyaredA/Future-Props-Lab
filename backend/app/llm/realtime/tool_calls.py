from __future__ import annotations

import asyncio
import json
from collections.abc import Callable
from typing import Any

from sqlalchemy import select

from app.llm.playground.test_tools import TestToolResult, execute_test_tool
from app.models import ModelTestTool, ModelTestToolCall
from app.orm import bind_workspace
from app.runtime.db import SessionLocal
from app.runtime.time import utc_now

TOOL_RESULT_LIMIT = 32 * 1024
TOOL_ARGUMENT_LIMIT = 64 * 1024


def provider_tool_definitions(snapshots: tuple[dict[str, Any], ...]) -> list[dict[str, Any]]:
    return [
        {
            "type": "function",
            "name": snapshot["name"],
            "description": snapshot.get("description") or "",
            "parameters": snapshot["input_schema"],
        }
        for snapshot in snapshots
    ]


def _json_size(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode())


class RealtimeToolExecutor:
    def __init__(
        self,
        *,
        workspace_id: str,
        trace_id: str,
        snapshots: tuple[dict[str, Any], ...],
        emit: Callable[[dict[str, Any]], None],
        submit_result: Callable[[str, object | None, dict[str, Any] | None], None],
    ) -> None:
        self.workspace_id = workspace_id
        self.trace_id = trace_id
        self.snapshots = {str(item["name"]): item for item in snapshots}
        self.emit = emit
        self.submit_result = submit_result
        self.tasks: dict[str, asyncio.Task[None]] = {}
        self.running_calls: set[str] = set()
        self.cancel_reasons: dict[str, str] = {}

    def start(self, event: dict[str, Any], *, round_index: int) -> None:
        call_id = str(event.get("call_id") or "").strip()
        if not call_id or call_id in self.tasks:
            return
        task = asyncio.create_task(
            self._run(event, round_index=round_index),
            name=f"realtime-tool-{call_id}",
        )
        self.tasks[call_id] = task

    async def cancel(self, call_id: str, reason: str = "工具调用已取消") -> None:
        task = self.tasks.get(call_id)
        if task is None or task.done():
            return
        self.cancel_reasons[call_id] = reason
        if call_id in self.running_calls:
            task.cancel(reason)
        await asyncio.gather(task, return_exceptions=True)

    async def shutdown(self) -> None:
        call_ids = [call_id for call_id, task in self.tasks.items() if not task.done()]
        if call_ids:
            await asyncio.gather(
                *(self.cancel(call_id, "通话已结束") for call_id in call_ids),
                return_exceptions=True,
            )

    async def _insert(
        self,
        *,
        snapshot: dict[str, Any],
        call_id: str,
        arguments: dict[str, Any],
        round_index: int,
    ) -> str:
        async with SessionLocal() as session:
            bind_workspace(session.sync_session, self.workspace_id)
            tool_id = str(snapshot.get("id") or "") or None
            if tool_id:
                existing = await session.scalar(
                    select(ModelTestTool.id).where(ModelTestTool.id == tool_id)
                )
                if existing is None:
                    tool_id = None
            row = ModelTestToolCall(
                tool_id=tool_id,
                source="realtime_voice",
                action_id=call_id,
                run_id=self.trace_id,
                round_index=round_index,
                tool_name=str(snapshot.get("name") or "unknown_tool")[:64],
                tool_revision=int(snapshot.get("revision") or 0),
                definition_snapshot=snapshot,
                arguments=arguments,
                status="running",
                configured_delay_ms=int(snapshot.get("delay_ms") or 0),
            )
            session.add(row)
            await session.commit()
            return row.id

    async def _settle(
        self,
        row_id: str,
        *,
        status: str,
        success: bool | None,
        result: object | None = None,
        error_code: str = "",
        error_message: str = "",
        duration_ms: int = 0,
    ) -> None:
        async with SessionLocal() as session:
            bind_workspace(session.sync_session, self.workspace_id)
            row = await session.get(ModelTestToolCall, row_id)
            if row is None:
                return
            row.status = status
            row.success = success
            row.result = result
            row.error_code = error_code
            row.error_message = error_message[:1000]
            row.duration_ms = max(0, duration_ms)
            row.updated_at = utc_now()
            await session.commit()

    def _update(
        self,
        *,
        turn_id: str,
        call_id: str,
        row_id: str,
        snapshot: dict[str, Any],
        arguments: dict[str, Any],
        status: str,
        success: bool | None,
        result: object | None = None,
        error_code: str = "",
        error_message: str = "",
        duration_ms: int = 0,
    ) -> None:
        self.emit(
            {
                "type": "tool_call_update",
                "turn_id": turn_id,
                "call_id": call_id,
                "id": row_id,
                "tool_id": snapshot.get("id"),
                "tool_name": snapshot.get("name") or "unknown_tool",
                "arguments": arguments,
                "status": status,
                "success": success,
                "result": result,
                "error_code": error_code,
                "error_message": error_message,
                "duration_ms": max(0, duration_ms),
            }
        )

    async def _run(self, event: dict[str, Any], *, round_index: int) -> None:
        call_id = str(event.get("call_id") or "").strip()
        turn_id = str(event.get("turn_id") or "").strip()
        name = str(event.get("name") or "").strip()
        raw_arguments = event.get("arguments")
        arguments = raw_arguments if isinstance(raw_arguments, dict) else {}
        snapshot = self.snapshots.get(name) or {
            "name": name or "unknown_tool",
            "description": "",
            "input_schema": {"type": "object", "properties": {}},
            "mock_kind": "failure",
            "mock_result": None,
            "error_code": "tool_not_available",
            "error_message": "模型请求了未启用的测试工具",
            "delay_ms": 0,
            "revision": 0,
        }
        row_id = ""
        try:
            row_id = await self._insert(
                snapshot=snapshot,
                call_id=call_id,
                arguments=arguments,
                round_index=round_index,
            )
            self._update(
                turn_id=turn_id,
                call_id=call_id,
                row_id=row_id,
                snapshot=snapshot,
                arguments=arguments,
                status="running",
                success=None,
            )
            self.running_calls.add(call_id)
            if call_id in self.cancel_reasons:
                raise asyncio.CancelledError(self.cancel_reasons[call_id])
            if raw_arguments is not None and not isinstance(raw_arguments, dict):
                result = TestToolResult(False, None, "invalid_arguments", "工具参数必须是对象", 0)
            elif _json_size(arguments) > TOOL_ARGUMENT_LIMIT:
                result = TestToolResult(
                    False,
                    None,
                    "invalid_arguments",
                    "工具参数不能超过 64 KiB",
                    0,
                )
            elif name not in self.snapshots:
                result = TestToolResult(
                    False,
                    None,
                    "tool_not_available",
                    "模型请求了未启用的测试工具",
                    0,
                )
            else:
                result = await execute_test_tool(snapshot, arguments)
            stored_result = result.result
            provider_result = result.result if result.success else None
            provider_error = (
                None
                if result.success
                else {
                    "code": result.error_code,
                    "message": result.error_message,
                }
            )
            if result.success and _json_size(provider_result) > TOOL_RESULT_LIMIT:
                result = TestToolResult(
                    False,
                    None,
                    "tool_result_too_large",
                    "工具返回结果超过实时语音的 32 KiB 限制",
                    result.duration_ms,
                )
                provider_result = None
                provider_error = {
                    "code": result.error_code,
                    "message": result.error_message,
                }
            status = "completed" if result.success else "failed"
            await self._settle(
                row_id,
                status=status,
                success=result.success,
                result=stored_result,
                error_code=result.error_code,
                error_message=result.error_message,
                duration_ms=result.duration_ms,
            )
            self._update(
                turn_id=turn_id,
                call_id=call_id,
                row_id=row_id,
                snapshot=snapshot,
                arguments=arguments,
                status=status,
                success=result.success,
                result=stored_result,
                error_code=result.error_code,
                error_message=result.error_message,
                duration_ms=result.duration_ms,
            )
            self.submit_result(call_id, provider_result, provider_error)
        except asyncio.CancelledError as exc:
            if row_id:
                reason = str(exc.args[0]) if exc.args else "工具调用已取消"
                await self._settle(
                    row_id,
                    status="cancelled",
                    success=False,
                    error_code="tool_cancelled",
                    error_message=reason,
                )
                self._update(
                    turn_id=turn_id,
                    call_id=call_id,
                    row_id=row_id,
                    snapshot=snapshot,
                    arguments=arguments,
                    status="cancelled",
                    success=False,
                    error_code="tool_cancelled",
                    error_message=reason,
                )
            raise
        except Exception:
            error_code = "tool_execution_failed"
            error_message = "工具执行异常，请重新通话"
            if row_id:
                await self._settle(
                    row_id,
                    status="failed",
                    success=False,
                    error_code=error_code,
                    error_message=error_message,
                )
            self._update(
                turn_id=turn_id,
                call_id=call_id,
                row_id=row_id or call_id,
                snapshot=snapshot,
                arguments=arguments,
                status="failed",
                success=False,
                error_code=error_code,
                error_message=error_message,
            )
            self.submit_result(
                call_id,
                None,
                {"code": error_code, "message": error_message},
            )
        finally:
            self.running_calls.discard(call_id)
            self.cancel_reasons.pop(call_id, None)
            self.tasks.pop(call_id, None)
