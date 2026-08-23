from __future__ import annotations

import asyncio
import json
import time
from dataclasses import dataclass
from typing import Any

from jsonschema import Draft202012Validator
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.time import iso_utc, utc_now
from app.models import (
    ModelTestConversationToolBinding,
    ModelTestTool,
    ModelTestToolCall,
)
from app.schemas.model_test_tools import (
    ModelTestToolCallOut,
    ModelTestToolCatalogOut,
    ModelTestToolCreateIn,
    ModelTestToolExecuteIn,
    ModelTestToolOut,
    ModelTestToolOverviewOut,
    ModelTestToolPatchIn,
    ModelTestToolSummaryOut,
)


class TestToolNotFoundError(Exception):
    pass


class DuplicateTestToolError(Exception):
    pass


class TestToolInUseError(Exception):
    def __init__(self, count: int) -> None:
        super().__init__(f"测试工具已被 {count} 个模型测试会话使用")
        self.count = count


class TestToolInputError(Exception):
    pass


class TestToolSelectionError(Exception):
    __test__ = False

    pass


@dataclass(frozen=True)
class TestToolResult:
    success: bool
    result: Any | None
    error_code: str
    error_message: str
    duration_ms: int


def tool_snapshot(row: ModelTestTool) -> dict[str, Any]:
    return {
        "id": row.id,
        "name": row.name,
        "description": row.description,
        "input_schema": dict(row.input_schema or {}),
        "mock_kind": row.mock_kind,
        "mock_result": row.mock_result,
        "error_code": row.error_code,
        "error_message": row.error_message,
        "delay_ms": row.delay_ms,
        "enabled": row.enabled,
        "revision": row.revision,
    }


async def load_selected_tool_snapshots(
    session: AsyncSession,
    tool_ids: list[str],
    *,
    maximum: int = 20,
) -> tuple[dict[str, Any], ...]:
    normalized = [str(tool_id).strip() for tool_id in tool_ids if str(tool_id).strip()]
    if len(normalized) != len(tool_ids) or len(normalized) > maximum:
        raise TestToolSelectionError(f"测试工具数量必须在 0 到 {maximum} 个之间")
    if len(set(normalized)) != len(normalized):
        raise TestToolSelectionError("测试工具不能重复选择")
    if not normalized:
        return ()
    rows = list(
        (await session.execute(select(ModelTestTool).where(ModelTestTool.id.in_(normalized))))
        .scalars()
        .all()
    )
    by_id = {row.id: row for row in rows}
    if any(tool_id not in by_id for tool_id in normalized):
        raise TestToolSelectionError("部分测试工具不存在或不属于当前 Workspace")
    if any(not by_id[tool_id].enabled for tool_id in normalized):
        raise TestToolSelectionError("部分测试工具已停用，请重新选择")
    return tuple(tool_snapshot(by_id[tool_id]) for tool_id in normalized)


async def execute_test_tool(snapshot: dict[str, Any], arguments: dict[str, Any]) -> TestToolResult:
    started = time.perf_counter()
    errors = sorted(
        Draft202012Validator(snapshot["input_schema"]).iter_errors(arguments),
        key=lambda item: list(item.absolute_path),
    )
    if errors:
        error = errors[0]
        path = ".".join(str(item) for item in error.absolute_path)
        message = f"{path}：{error.message}" if path else error.message
        return TestToolResult(False, None, "invalid_arguments", message, 0)
    delay_ms = int(snapshot.get("delay_ms") or 0)
    if delay_ms:
        await asyncio.sleep(delay_ms / 1000)
    duration_ms = max(0, round((time.perf_counter() - started) * 1000))
    if snapshot.get("mock_kind") == "failure":
        return TestToolResult(
            False,
            None,
            str(snapshot.get("error_code") or "mock_failure"),
            str(snapshot.get("error_message") or "模拟工具执行失败"),
            duration_ms,
        )
    return TestToolResult(True, snapshot.get("mock_result"), "", "", duration_ms)


def call_out(row: ModelTestToolCall) -> ModelTestToolCallOut:
    return ModelTestToolCallOut(
        id=row.id,
        source=row.source,
        conversation_id=row.conversation_id,
        message_id=row.message_id,
        run_id=row.run_id,
        round_index=row.round_index,
        tool_id=row.tool_id,
        tool_name=row.tool_name,
        tool_revision=row.tool_revision,
        arguments=dict(row.arguments or {}),
        status=row.status,
        success=row.success,
        result=row.result,
        error_code=row.error_code,
        error_message=row.error_message,
        configured_delay_ms=row.configured_delay_ms,
        duration_ms=row.duration_ms,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


class ModelTestTools:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _row(self, tool_id: str) -> ModelTestTool:
        row = await self.session.get(ModelTestTool, tool_id)
        if row is None:
            raise TestToolNotFoundError("测试工具不存在")
        return row

    async def _binding_count(self, tool_id: str) -> int:
        return int(
            await self.session.scalar(
                select(func.count(ModelTestConversationToolBinding.tool_id)).where(
                    ModelTestConversationToolBinding.tool_id == tool_id
                )
            )
            or 0
        )

    async def _last_used_at(self, tool_id: str):
        return await self.session.scalar(
            select(func.max(ModelTestToolCall.created_at)).where(
                ModelTestToolCall.tool_id == tool_id
            )
        )

    async def summary(self, row: ModelTestTool) -> ModelTestToolSummaryOut:
        last_used_at = await self._last_used_at(row.id)
        properties = dict((row.input_schema or {}).get("properties") or {})
        return ModelTestToolSummaryOut(
            id=row.id,
            name=row.name,
            description=row.description,
            parameter_count=len(properties),
            mock_kind=row.mock_kind,
            delay_ms=row.delay_ms,
            enabled=row.enabled,
            revision=row.revision,
            last_used_at=iso_utc(last_used_at) if last_used_at else None,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def _out(self, row: ModelTestTool) -> ModelTestToolOut:
        summary = await self.summary(row)
        calls = list(
            (
                await self.session.execute(
                    select(ModelTestToolCall)
                    .where(ModelTestToolCall.tool_id == row.id)
                    .order_by(ModelTestToolCall.created_at.desc())
                    .limit(20)
                )
            )
            .scalars()
            .all()
        )
        return ModelTestToolOut(
            **summary.model_dump(),
            input_schema=dict(row.input_schema or {}),
            mock_result=row.mock_result,
            error_code=row.error_code,
            error_message=row.error_message,
            bound_conversation_count=await self._binding_count(row.id),
            recent_calls=[call_out(item) for item in calls],
        )

    async def catalog(self) -> ModelTestToolCatalogOut:
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestTool).order_by(
                        ModelTestTool.updated_at.desc(), ModelTestTool.name
                    )
                )
            )
            .scalars()
            .all()
        )
        summaries = [await self.summary(row) for row in rows]
        today = utc_now().replace(hour=0, minute=0, second=0, microsecond=0)
        today_runs = int(
            await self.session.scalar(
                select(func.count(ModelTestToolCall.id)).where(
                    ModelTestToolCall.created_at >= today
                )
            )
            or 0
        )
        recent = sorted(
            (item for item in summaries if item.last_used_at),
            key=lambda item: item.last_used_at or "",
            reverse=True,
        )[:5]
        return ModelTestToolCatalogOut(
            items=summaries,
            overview=ModelTestToolOverviewOut(
                total=len(rows),
                enabled=sum(row.enabled for row in rows),
                failure=sum(row.mock_kind == "failure" for row in rows),
                today_runs=today_runs,
                recent=recent,
            ),
        )

    async def get(self, tool_id: str) -> ModelTestToolOut:
        return await self._out(await self._row(tool_id))

    async def create(self, body: ModelTestToolCreateIn) -> ModelTestToolOut:
        row = ModelTestTool(**body.model_dump())
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateTestToolError("当前 Workspace 已存在同名测试工具") from exc
        await self.session.refresh(row)
        return await self._out(row)

    async def update(self, tool_id: str, body: ModelTestToolPatchIn) -> ModelTestToolOut:
        row = await self._row(tool_id)
        if row.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, row.revision, (await self._out(row)).model_dump(mode="json")
            )
        values = body.model_dump(exclude={"expected_revision"})
        result = await self.session.execute(
            update(ModelTestTool)
            .where(ModelTestTool.id == tool_id, ModelTestTool.revision == body.expected_revision)
            .values(**values, revision=ModelTestTool.revision + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            current = await self._row(tool_id)
            raise RevisionConflictError(
                body.expected_revision,
                current.revision,
                (await self._out(current)).model_dump(mode="json"),
            )
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise DuplicateTestToolError("当前 Workspace 已存在同名测试工具") from exc
        return await self.get(tool_id)

    async def delete(self, tool_id: str, expected_revision: int) -> None:
        row = await self._row(tool_id)
        if row.revision != expected_revision:
            raise RevisionConflictError(
                expected_revision, row.revision, (await self._out(row)).model_dump(mode="json")
            )
        count = await self._binding_count(tool_id)
        if count:
            raise TestToolInUseError(count)
        await self.session.execute(delete(ModelTestTool).where(ModelTestTool.id == tool_id))
        await self.session.commit()

    async def execute(self, tool_id: str, body: ModelTestToolExecuteIn) -> ModelTestToolCallOut:
        row = await self._row(tool_id)
        if row.revision != body.expected_revision:
            raise RevisionConflictError(
                body.expected_revision, row.revision, (await self._out(row)).model_dump(mode="json")
            )
        snapshot = tool_snapshot(row)
        validation = await execute_test_tool({**snapshot, "delay_ms": 0}, body.input)
        if validation.error_code == "invalid_arguments":
            raise TestToolInputError(validation.error_message)
        call = ModelTestToolCall(
            tool_id=row.id,
            source="dry_run",
            tool_name=row.name,
            tool_revision=row.revision,
            definition_snapshot=snapshot,
            arguments=body.input,
            status="running",
            configured_delay_ms=row.delay_ms,
        )
        self.session.add(call)
        await self.session.commit()
        result = await execute_test_tool(snapshot, body.input)
        call.status = "completed" if result.success else "failed"
        call.success = result.success
        call.result = result.result
        call.error_code = result.error_code
        call.error_message = result.error_message
        call.duration_ms = result.duration_ms
        call.updated_at = utc_now()
        await self.session.commit()
        await self.session.refresh(call)
        return call_out(call)


def model_result_text(result: TestToolResult) -> str:
    if result.success:
        return json.dumps(result.result, ensure_ascii=False, separators=(",", ":"))
    return json.dumps(
        {"ok": False, "error": {"code": result.error_code, "message": result.error_message}},
        ensure_ascii=False,
        separators=(",", ":"),
    )
