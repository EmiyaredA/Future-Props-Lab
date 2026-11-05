"""Own Visual assistant admission, immutable provider rounds and call log receipts."""

import asyncio
from datetime import timedelta

from sqlalchemy import select, text

from app.capabilities.agents.harness.contracts import Usage
from app.llm.assistant_catalog import chat_ready
from app.llm.credential_snapshot import snapshot_from_actor
from app.llm.models import LlmCallLog, ModelEntry, ModelProvider, RuntimeAdmission
from app.llm.providers.agent import HttpAgentAdapter
from app.llm.visual_review import fixed_connection_signature
from app.runtime.credentials import decrypt_secret
from app.runtime.ids import new_id
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant_model import (
    AssistantModelPlan,
    ErrorEvent,
    TurnEvent,
    UsageEvent,
    from_model,
)

from .admission import check_capacity
from .assistant_model_records import VisualAssistantModelRun

UNKNOWN = "模型轮次执行中断，结果未知"
MAX_RESULT_BYTES = 4 * 1024**2


def conflict(message, code):
    return ProjectResourceError(message, code, 409)


async def selected(session, identity, *, vision):
    row = (
        await session.execute(
            select(ModelEntry, ModelProvider)
            .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
            .where(ModelEntry.id == identity)
        )
    ).one_or_none()
    if row is None or not chat_ready(*row, require_vision=vision):
        raise conflict("视觉对话模型已不可用", "visual_assistant_model_unavailable")
    return row


def plan(pair):
    model, provider = pair
    return AssistantModelPlan(
        id=model.id,
        model_slug=model.slug,
        provider_kind=provider.kind,
        tools_enabled="tools" in (model.capabilities or []),
    )


async def release(session, lease_id):
    row = await session.get(RuntimeAdmission, lease_id)
    if row is not None and row.released_at is None:
        row.released_at = utc_now()


class AssistantModelRuns:
    def __init__(self, sessions):
        self.sessions = sessions

    async def recover(self):
        await self.interrupt_before(utc_now())

    async def expire(self):
        await self.interrupt_before(utc_now() - timedelta(minutes=30))

    async def interrupt_before(self, cutoff):
        model = VisualAssistantModelRun
        async with self.sessions(info={"allow_system_reads": True}) as db:
            owners = list(
                await db.scalars(
                    select(model.owner_user_id)
                    .where(model.state == "open", model.updated_at < cutoff)
                    .distinct()
                )
            )
        for owner in owners:
            async with self.sessions(info={"owner_user_id": owner}) as db:
                await db.execute(text("BEGIN IMMEDIATE"))
                interrupted = list(
                    await db.scalars(
                        select(model).where(model.state == "open", model.updated_at < cutoff)
                    )
                )
                for row in interrupted:
                    row.state = "unknown"
                    if row.round_state == "submitting":
                        row.round_state = "unknown"
                    await release(db, row.lease_id)
                await db.commit()

    async def begin(self, actor, request):
        await self.expire()
        owner = actor.user_id
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            prior = await db.get(VisualAssistantModelRun, (owner, request.run_id))
            if prior is not None:
                if prior.start_digest != request.digest:
                    raise conflict("对话运行摘要已变化", "visual_assistant_request_conflict")
                return prior.model_plan
            pair = await selected(db, request.model_id, vision=request.require_vision)
            model = plan(pair)
            if model.tools_enabled != request.tools_enabled:
                raise conflict("对话模型工具能力已变化", "visual_assistant_model_changed")
            await check_capacity(db, owner=owner, role=actor.platform_role)
            lease = new_id()
            db.add(
                RuntimeAdmission(
                    id=lease,
                    user_id=owner,
                    owner_user_id=owner,
                    platform_role=actor.platform_role,
                    realtime_voice=False,
                    weight=1,
                )
            )
            row = VisualAssistantModelRun(
                owner_user_id=owner,
                run_id=request.run_id,
                project_id=request.project_id,
                conversation_id=request.conversation_id,
                start_digest=request.digest,
                model_id=model.id,
                model_signature=fixed_connection_signature(pair),
                model_plan=model.model_dump(),
                request_summary=request.request_summary,
                trace_id=request.trace_id,
                lease_id=lease,
            )
            db.add(row)
            await db.commit()
            return row.model_plan

    @staticmethod
    async def row(db, owner, request):
        row = await db.get(VisualAssistantModelRun, (owner, request.run_id))
        if row is None or (row.project_id, row.conversation_id) != (
            request.project_id,
            request.conversation_id,
        ):
            raise ProjectResourceError("模型对话运行不存在")
        return row

    async def prepare_round(self, actor, request):
        owner = actor.user_id
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(db, owner, request)
            if row.state != "open":
                raise conflict(UNKNOWN, "visual_assistant_run_closed")
            if row.round_index == request.index and row.round_digest == request.digest:
                if row.round_state in {"completed", "failed"}:
                    return None, row.round_events
                raise conflict(UNKNOWN, "visual_assistant_round_unconfirmed")
            if request.index != row.round_index + 1 or row.round_state not in (None, "completed"):
                raise conflict("模型轮次顺序或摘要已变化", "visual_assistant_round_conflict")
            pair = await selected(
                db, row.model_id, vision=any(message.images for message in request.messages)
            )
            if fixed_connection_signature(pair) != row.model_signature:
                raise conflict("对话模型连接已变化", "visual_assistant_model_changed")
            model, provider = pair
            if request.tools and not row.model_plan["tools_enabled"]:
                raise conflict("当前模型未启用工具", "visual_assistant_model_changed")
            args = {
                "kind": provider.kind,
                "base_url": provider.base_url,
                "api_key": decrypt_secret(provider.api_key_ciphertext)
                if provider.api_key_ciphertext
                else "",
            }
            row.round_index, row.round_digest = request.index, request.digest
            row.round_state, row.round_events = "submitting", []
            await db.commit()
            return (model.slug, args), None

    async def stream(self, actor, request, prepared, *, transport=None):
        configuration, replay = prepared
        if replay is not None:
            for event in replay:
                yield encode_event(event)
            return
        slug, args = configuration
        events, usage, size = [], Usage(), 0
        try:
            adapter = HttpAgentAdapter(**args, transport=transport)
            async for event in adapter.stream_turn(
                system=request.system,
                messages=request.messages,
                tools=request.tools,
                model=slug,
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                round_index=request.index,
            ):
                wire = from_model(event)
                if isinstance(wire, (UsageEvent, TurnEvent)):
                    usage = wire.usage
                body = wire.model_dump(mode="json")
                line = encode_event(body)
                size += len(line)
                if size > MAX_RESULT_BYTES:
                    raise ValueError("模型轮次结果超过上限")
                events.append(body)
                if isinstance(wire, TurnEvent):
                    await self.complete_round(actor.user_id, request, "completed", events, usage)
                    yield line
                    return
                yield line
            raise ValueError("模型未返回轮次完成事件")
        except (asyncio.CancelledError, GeneratorExit):
            await asyncio.shield(self.complete_round(actor.user_id, request, "unknown", [], usage))
            raise
        except Exception:
            error = ErrorEvent(error="模型流式调用中断或响应无效").model_dump()
            await self.complete_round(actor.user_id, request, "failed", [*events, error], usage)
            yield encode_event(error)

    async def complete_round(self, owner, request, state, events, usage):
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(db, owner, request)
            if (
                row.state != "open"
                or row.round_digest != request.digest
                or row.round_state != "submitting"
            ):
                return
            row.round_state, row.round_events = state, events
            combined = Usage(**row.usage).merged(usage)
            row.usage = {
                key: getattr(combined, key)
                for key in ("prompt_tokens", "completion_tokens", "total_tokens")
            }
            await db.commit()

    async def settle(self, actor, request):
        owner = actor.user_id
        async with self.sessions(info={"owner_user_id": owner}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(db, owner, request)
            if row.settlement is not None:
                if row.settlement_sha256 != request.digest:
                    raise conflict("模型对话已结算", "visual_assistant_settlement_conflict")
                return row.settlement
            if row.state == "open" and row.round_state == "submitting":
                raise conflict("模型轮次仍在结算", "visual_assistant_round_in_progress")
            if request.status == "completed" and (
                row.state != "open" or row.round_state != "completed"
            ):
                raise conflict(UNKNOWN, "visual_assistant_round_unconfirmed")
            latency = max(0, round((utc_now() - row.created_at).total_seconds() * 1000))
            plan = row.model_plan
            log = LlmCallLog(
                id=new_id(),
                owner_user_id=owner,
                call_source="visual_workshop_assistant",
                provider_kind=plan["provider_kind"],
                model=plan["model_slug"],
                trace_id=row.trace_id,
                request_payload={
                    **row.request_summary,
                    "run_id": row.run_id,
                    "agent_mode": "tools" if plan["tools_enabled"] else "advice",
                    "rounds": row.round_index + 1,
                    "actions": request.actions,
                },
                response_payload={
                    "status": request.status,
                    "run_status": request.run_status,
                    "actions": request.actions,
                    "finish_reason": request.finish_reason,
                    "first_token_latency_ms": request.first_token_latency_ms,
                    "rounds": row.round_index + 1,
                },
                latency_ms=latency,
                status="success" if request.status == "completed" else "error",
                error_message=request.error_message,
                **row.usage,
                **snapshot_from_actor(actor).as_kwargs(),
            )
            row.state = "settled"
            row.settlement_sha256 = request.digest
            row.settlement = {"log_id": log.id, "latency_ms": latency, **row.usage}
            row.round_events = []
            await release(db, row.lease_id)
            db.add(log)
            await db.commit()
            return row.settlement


def encode_event(event):
    import json

    return (json.dumps(event, ensure_ascii=False, separators=(",", ":")) + "\n").encode()


class AssistantModelExpiry(PollingTaskRunner):
    runner_name = "visual-assistant-model-expiry"
    poll_interval_seconds = 60

    def __init__(self, attempts):
        super().__init__()
        self.attempts = attempts

    async def recover(self):
        return

    async def process_once(self):
        await self.attempts.expire()
