"""Durable lifecycle for one active Amadeus task per signed-in owner."""

from __future__ import annotations

import json

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from app.console.amadeus.schemas import (
    RunCreateIn,
    RunDetailOut,
    RunEventIn,
    RunEventOut,
    RunOut,
)
from app.runtime.db import SessionLocal
from app.runtime.operation_receipts import OperationError
from app.runtime.time import utc_now

ACTIVE = frozenset({"running", "cancelling"})
TERMINAL = frozenset(
    {"completed", "failed", "cancelled", "interrupted", "waiting_question", "waiting_approval"}
)
MAX_PARTIAL_TEXT = 100_000
MAX_EVENT_BYTES = 1024 * 1024


def _event(row: AmadeusRunEvent) -> RunEventOut:
    return RunEventOut(
        id=row.id,
        run_id=row.run_id,
        sequence=row.sequence,
        kind=row.kind,
        payload=row.payload_json,
        idempotency_key=row.idempotency_key,
        created_at=row.created_at,
    )


def _run(row: AmadeusRun) -> RunOut:
    return RunOut(
        id=row.id,
        conversation_id=row.conversation_id,
        model_id=row.model_id,
        mode=row.mode,
        source_run_id=row.source_run_id,
        status=row.status,
        context=row.context_json,
        references=row.references_json,
        capabilities=row.capabilities_json,
        partial_text=row.partial_text,
        heartbeat_at=row.heartbeat_at,
        error_message=row.error_message,
        created_at=row.created_at,
        updated_at=row.updated_at,
        finished_at=row.finished_at,
    )


class Runs:
    def __init__(self, session, principal):
        self.session, self.principal = session, principal

    async def _conversation(self, identity: str) -> AmadeusConversation:
        row = await self.session.scalar(
            select(AmadeusConversation).where(
                AmadeusConversation.id == identity,
                AmadeusConversation.workspace_id == self.principal.workspace_id,
                AmadeusConversation.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("对话不存在", "not_found", 404)
        return row

    async def get(self, conversation_id: str, run_id: str) -> AmadeusRun:
        row = await self.session.scalar(
            select(AmadeusRun).where(
                AmadeusRun.id == run_id,
                AmadeusRun.conversation_id == conversation_id,
                AmadeusRun.workspace_id == self.principal.workspace_id,
                AmadeusRun.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("运行不存在", "not_found", 404)
        return row

    async def get_by_id(self, run_id: str) -> AmadeusRun:
        row = await self.session.scalar(
            select(AmadeusRun).where(
                AmadeusRun.id == run_id,
                AmadeusRun.workspace_id == self.principal.workspace_id,
                AmadeusRun.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("运行不存在", "not_found", 404)
        return row

    async def active(self) -> RunDetailOut | None:
        row = await self.session.scalar(
            select(AmadeusRun).where(
                AmadeusRun.workspace_id == self.principal.workspace_id,
                AmadeusRun.user_id == self.principal.user_id,
                AmadeusRun.active_owner_key.is_not(None),
            )
        )
        return await self.detail(row.conversation_id, row.id) if row else None

    async def create(self, conversation_id: str, body: RunCreateIn) -> RunDetailOut:
        await self._conversation(conversation_id)
        unresolved_question = await self.session.scalar(
            select(AmadeusQuestion.id).where(
                AmadeusQuestion.conversation_id == conversation_id,
                AmadeusQuestion.workspace_id == self.principal.workspace_id,
                AmadeusQuestion.user_id == self.principal.user_id,
                AmadeusQuestion.status == "pending",
            )
        )
        unresolved_action = await self.session.scalar(
            select(AmadeusAction.id).where(
                AmadeusAction.conversation_id == conversation_id,
                AmadeusAction.workspace_id == self.principal.workspace_id,
                AmadeusAction.user_id == self.principal.user_id,
                AmadeusAction.run_id.is_not(None),
                AmadeusAction.status.in_(("pending", "approved", "running")),
            )
        )
        if unresolved_question or unresolved_action:
            raise OperationError("请先处理当前提问或审批", "interaction_pending", 409)
        if body.source_run_id:
            source = await self.get(conversation_id, body.source_run_id)
            if source.status == "completed" and source.mode == "plan":
                if body.mode != "agent":
                    raise OperationError("计划只能切换到 Agent 执行", "invalid_continuation", 422)
            elif source.status == "waiting_question":
                question = await self.session.scalar(
                    select(AmadeusQuestion).where(AmadeusQuestion.run_id == source.id)
                )
                if question is None or question.status != "answered" or body.mode != source.mode:
                    raise OperationError("提问尚未回答", "invalid_continuation", 409)
            elif source.status == "waiting_approval":
                action = await self.session.scalar(
                    select(AmadeusAction).where(AmadeusAction.run_id == source.id)
                )
                if (
                    action is None
                    or action.status not in {"completed", "failed", "rejected", "cancelled"}
                    or body.mode != "agent"
                ):
                    raise OperationError("操作尚未完成或结果待核实", "invalid_continuation", 409)
            else:
                raise OperationError("来源运行不可继续", "invalid_continuation", 409)
        now = utc_now()
        row = AmadeusRun(
            conversation_id=conversation_id,
            workspace_id=self.principal.workspace_id,
            user_id=self.principal.user_id,
            model_id=body.model_id,
            mode=body.mode,
            source_run_id=body.source_run_id,
            status="running",
            active_owner_key=f"{self.principal.workspace_id}:{self.principal.user_id}",
            context_json=body.context,
            references_json=[item.model_dump(mode="json") for item in body.references],
            capabilities_json=body.capabilities,
            heartbeat_at=now,
            created_at=now,
            updated_at=now,
        )
        self.session.add(row)
        try:
            await self.session.commit()
        except IntegrityError as exc:
            await self.session.rollback()
            raise OperationError(
                "已有任务正在运行或继续请求已处理", "run_already_active", 409
            ) from exc
        return await self.detail(conversation_id, row.id)

    async def detail(self, conversation_id: str, run_id: str) -> RunDetailOut:
        row = await self.get(conversation_id, run_id)
        events = (
            await self.session.scalars(
                select(AmadeusRunEvent)
                .where(AmadeusRunEvent.run_id == row.id)
                .order_by(AmadeusRunEvent.sequence)
            )
        ).all()
        return RunDetailOut(run=_run(row), events=[_event(item) for item in events])

    async def history(self, conversation_id: str) -> list[RunDetailOut]:
        await self._conversation(conversation_id)
        rows = list(
            await self.session.scalars(
                select(AmadeusRun)
                .where(
                    AmadeusRun.conversation_id == conversation_id,
                    AmadeusRun.workspace_id == self.principal.workspace_id,
                    AmadeusRun.user_id == self.principal.user_id,
                )
                .order_by(AmadeusRun.created_at)
            )
        )
        return [await self.detail(conversation_id, row.id) for row in rows]

    async def append_event(
        self, conversation_id: str, run_id: str, body: RunEventIn
    ) -> RunEventOut:
        row = await self.get(conversation_id, run_id)
        existing = await self.session.scalar(
            select(AmadeusRunEvent).where(
                AmadeusRunEvent.run_id == run_id,
                AmadeusRunEvent.idempotency_key == body.idempotency_key,
            )
        )
        if existing:
            return _event(existing)
        if row.status not in ACTIVE:
            raise OperationError("运行已经结束", "run_not_active", 409)
        if len(json.dumps(body.payload, ensure_ascii=False).encode()) > MAX_EVENT_BYTES:
            raise OperationError("运行事件超过 1 MiB", "event_too_large", 422)
        if body.kind == "assistant_delta":
            text = body.payload.get("text")
            if not isinstance(text, str) or not text:
                raise OperationError("增量文本无效", "invalid_event", 422)
            if len(row.partial_text) + len(text) > MAX_PARTIAL_TEXT:
                raise OperationError("回复超过 100000 字", "event_too_large", 422)
            row.partial_text += text
        now = utc_now()
        row.last_event_sequence += 1
        row.heartbeat_at = now
        row.updated_at = now
        event = AmadeusRunEvent(
            run_id=row.id,
            workspace_id=self.principal.workspace_id,
            sequence=row.last_event_sequence,
            kind=body.kind,
            payload_json=body.payload,
            idempotency_key=body.idempotency_key,
            created_at=now,
        )
        self.session.add(event)
        try:
            await self.session.commit()
        except IntegrityError:
            await self.session.rollback()
            existing = await self.session.scalar(
                select(AmadeusRunEvent).where(
                    AmadeusRunEvent.run_id == run_id,
                    AmadeusRunEvent.idempotency_key == body.idempotency_key,
                )
            )
            if existing:
                return _event(existing)
            raise OperationError("运行事件发生并发冲突", "event_conflict", 409) from None
        return _event(event)

    async def heartbeat(self, conversation_id: str, run_id: str) -> RunOut:
        row = await self.get(conversation_id, run_id)
        if row.status not in ACTIVE:
            raise OperationError("运行已经结束", "run_not_active", 409)
        row.heartbeat_at = row.updated_at = utc_now()
        await self.session.commit()
        return _run(row)

    async def mark_cancelling(self, conversation_id: str, run_id: str) -> RunOut:
        row = await self.get(conversation_id, run_id)
        if row.status in TERMINAL:
            return _run(row)
        row.status = "cancelling"
        row.updated_at = utc_now()
        await self.session.commit()
        return _run(row)

    async def pause_for_approval(self, conversation_id: str, run_id: str) -> RunDetailOut:
        row = await self.get(conversation_id, run_id)
        if row.status != "running" or row.mode != "agent":
            raise OperationError("运行不可等待审批", "run_not_active", 409)
        pending = await self.session.scalar(
            select(AmadeusAction.id).where(
                AmadeusAction.run_id == row.id, AmadeusAction.status == "pending"
            )
        )
        if pending is None:
            raise OperationError("没有待审批操作", "approval_conflict", 409)
        now = utc_now()
        row.status = "waiting_approval"
        row.active_owner_key = None
        row.finished_at = row.updated_at = now
        await self._save_partial(row)
        await self.session.commit()
        return await self.detail(conversation_id, run_id)

    async def _save_partial(self, row: AmadeusRun) -> None:
        if row.partial_text and not row.response_message_id:
            message = AmadeusMessage(
                conversation_id=row.conversation_id,
                workspace_id=row.workspace_id,
                role="assistant",
                content=row.partial_text,
                references_json=[],
                run_id=row.id,
                status=row.status,
            )
            self.session.add(message)
            await self.session.flush()
            row.response_message_id = message.id

    async def finish(
        self, conversation_id: str, run_id: str, status: str, error_message: str | None
    ) -> RunDetailOut:
        row = await self.get(conversation_id, run_id)
        if row.status in TERMINAL:
            return await self.detail(conversation_id, run_id)
        if status not in {"completed", "failed", "cancelled", "interrupted"}:
            raise OperationError("运行终态无效", "invalid_status", 422)
        now = utc_now()
        row.status = status
        row.active_owner_key = None
        row.error_message = error_message
        row.finished_at = row.updated_at = now
        await self._save_partial(row)
        await self.session.execute(
            update(AmadeusAction)
            .where(AmadeusAction.run_id == row.id, AmadeusAction.status == "pending")
            .values(
                status="cancelled" if status == "cancelled" else "rejected",
                result_json={"message": "运行已经结束，操作未执行"},
                updated_at=now,
            )
        )
        await self.session.execute(
            update(AmadeusAction)
            .where(AmadeusAction.run_id == row.id, AmadeusAction.status == "running")
            .values(
                status="unknown",
                result_json={"message": "运行中断；请核实外部操作实际状态"},
                updated_at=now,
            )
        )
        await self.session.commit()
        return await self.detail(conversation_id, run_id)


async def recover_interrupted_amadeus_runs() -> None:
    """Settle process-owned work before accepting new runs after startup."""
    now = utc_now()
    async with SessionLocal() as session:
        rows = list(await session.scalars(select(AmadeusRun).where(AmadeusRun.status.in_(ACTIVE))))
        if not rows:
            return
        active_ids = [row.id for row in rows]
        for row in rows:
            if row.partial_text and not row.response_message_id:
                message = AmadeusMessage(
                    conversation_id=row.conversation_id,
                    workspace_id=row.workspace_id,
                    role="assistant",
                    content=row.partial_text,
                    references_json=[],
                    run_id=row.id,
                    status="interrupted",
                )
                session.add(message)
                await session.flush()
                row.response_message_id = message.id
        await session.execute(
            update(AmadeusRun)
            .where(AmadeusRun.id.in_(active_ids))
            .values(
                status="interrupted",
                active_owner_key=None,
                error_message="后端重启，任务已中断；未知结果不会自动重试",
                finished_at=now,
                updated_at=now,
            )
        )
        await session.execute(
            update(AmadeusAction)
            .where(AmadeusAction.run_id.in_(active_ids), AmadeusAction.status == "running")
            .values(
                status="unknown",
                result_json={"message": "后端重启，外部操作结果待核实"},
                updated_at=now,
            )
        )
        await session.execute(
            update(AmadeusAction)
            .where(AmadeusAction.run_id.in_(active_ids), AmadeusAction.status == "pending")
            .values(
                status="cancelled",
                result_json={"message": "运行中断，审批已失效"},
                updated_at=now,
            )
        )
        await session.commit()
