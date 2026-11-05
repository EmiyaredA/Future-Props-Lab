"""Own assistant message settlement and replay a signed Models log receipt."""

import httpx
from sqlalchemy import select, text

from studio.apps.visual_workshop.assistant_values import action_out, message_out
from studio.apps.visual_workshop.storage.assistant_dispatch_records import VisualAssistantDispatch
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
)
from studio.contracts.visual_workshop.visual_assistant_model import (
    AssistantRunSettle,
    RecoveredAssistantSettlement,
)
from studio.runtime.http.capability_client import CapabilityUnavailable
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import utc_now

ACTIVE = {"proposed", "waiting_approval", "running"}


class AssistantDispatches(PollingTaskRunner):
    runner_name = "visual-assistant-settlements"
    poll_interval_seconds = 1

    def __init__(self, state, peer):
        super().__init__()
        self.sessions = state.database.sessions
        self.client = state.capabilities.client
        self.peer = peer

    async def prepare(self, owner, scope, trace_id):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            db.add(
                VisualAssistantDispatch(
                    **scope.model_dump(),
                    owner_user_id=owner,
                    trace_id=trace_id,
                )
            )
            await db.commit()

    async def cancel_before_stream(self, owner, identity):
        await self.finish(
            owner,
            identity,
            status="cancelled",
            run_status="cancelled",
            content="",
            error="对话运行未开始",
            finish_reason="cancelled",
        )

    async def recover(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            interrupted = list(
                (
                    await db.execute(
                        select(
                            VisualAssistantDispatch.owner_user_id, VisualAssistantDispatch.run_id
                        ).where(VisualAssistantDispatch.phase.in_(("preparing", "streaming")))
                    )
                ).tuples()
            )
        for owner, run_id in interrupted:
            await self.finish(
                owner,
                run_id,
                status="cancelled",
                run_status="cancelled",
                content="",
                error="服务重启，本轮运行已取消",
                finish_reason="cancelled",
            )

    async def process_once(self):
        async with self.sessions(info={"allow_system_reads": True}) as db:
            pending = list(
                (
                    await db.execute(
                        select(
                            VisualAssistantDispatch.owner_user_id, VisualAssistantDispatch.run_id
                        )
                        .where(VisualAssistantDispatch.phase == "settling")
                        .order_by(
                            VisualAssistantDispatch.updated_at, VisualAssistantDispatch.run_id
                        )
                        .limit(40)
                    )
                ).tuples()
            )
        failure = None
        for owner, run_id in pending:
            try:
                await self.deliver(owner, run_id)
            except CapabilityUnavailable as exc:
                failure = failure or exc
        if failure is not None:
            raise failure

    async def finish(
        self, owner, run_id, *, status, run_status, content, error, finish_reason, first_token=None
    ):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(VisualAssistantDispatch, run_id)
            if row is None or row.phase not in {"preparing", "streaming"}:
                return None, None, None
            message = (
                await db.get(VisualAssistantMessage, row.message_id) if row.message_id else None
            )
            actions = []
            revision = None
            if message is not None:
                actions = list(
                    await db.scalars(
                        select(VisualAssistantAction)
                        .where(VisualAssistantAction.message_id == message.id)
                        .order_by(VisualAssistantAction.position)
                    )
                )
                if status != "completed":
                    for action in actions:
                        if action.status in ACTIVE:
                            action.status = "cancelled"
                            action.error_message = error
                            action.updated_at = utc_now()
                if message.status == "pending":
                    message.content = content
                    message.status = status
                    message.error_message = error
                    message.updated_at = utc_now()
                    conversation = await db.get(VisualAssistantConversation, row.conversation_id)
                    conversation.revision += 1
                    conversation.updated_at = utc_now()
                    revision = conversation.revision
            outcome = AssistantRunSettle(
                run_id=run_id,
                project_id=row.project_id,
                conversation_id=row.conversation_id,
                status=status,
                run_status=run_status,
                error_message=error,
                first_token_latency_ms=first_token,
                finish_reason=finish_reason,
                actions=[action_log(action) for action in actions],
            )
            row.settlement = RecoveredAssistantSettlement(
                trace_id=row.trace_id, outcome=outcome
            ).model_dump(mode="json")
            row.phase = "settling"
            result = (
                message_out(message, actions=[action_out(action) for action in actions])
                if message is not None
                else None
            )
            await db.commit()
            return result, revision, row.settlement

    async def deliver(self, owner, identity, *, settlement=None):
        if self.peer is None:
            raise CapabilityUnavailable("对话结算端口未配置")
        async with self.sessions(info={"owner_user_id": owner}) as db:
            row = await db.get(VisualAssistantDispatch, identity)
            if row is None and settlement is None:
                return None
            if row is not None and row.phase != "settling":
                return None
            stored = row.settlement if row is not None else settlement
            missing_is_final = row is not None and row.message_id is None
        request = RecoveredAssistantSettlement.model_validate(stored)
        try:
            response = await self.client.post(
                "http://models:8080" + request.path,
                headers=self.peer.headers("POST", request.path, owner),
                json=request.model_dump(mode="json"),
            )
            result = None
            if response.status_code != 404 or not missing_is_final:
                response.raise_for_status()
                result = response.json()
                if not isinstance(result.get("log_id"), str):
                    raise ValueError("missing Models settlement receipt")
        except (httpx.HTTPError, ValueError) as exc:
            raise CapabilityUnavailable("对话模型日志回执未确认") from exc
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await db.get(VisualAssistantDispatch, identity)
            if row is not None and row.phase == "settling" and row.settlement == stored:
                await db.delete(row)
                await db.commit()
        return result


def action_log(row):
    return {
        "tool_name": row.tool_name,
        "effect": row.effect,
        "status": row.status,
        "duration_ms": row.duration_ms,
        "canvas_revision": row.canvas_revision,
        "generation_task_id": row.generation_task_id,
        "input": row.display_payload,
        "result": row.result_payload,
        "error_message": row.error_message,
    }
