"""Stream the Visual harness while retaining its durable local and Models outcomes."""

import asyncio
from contextlib import suppress
from time import monotonic

import httpx
from anyio import CancelScope

from studio.apps.visual_workshop.assistant.assistant_canvas_actions import AssistantCanvasActions
from studio.apps.visual_workshop.assistant.assistant_generation_action import (
    AssistantGenerationAction,
)
from studio.apps.visual_workshop.assistant.assistant_tool_reads import AssistantToolReads
from studio.apps.visual_workshop.assistant_action_records import persist_agent_event
from studio.apps.visual_workshop.assistant_tool_values import build_visual_agent_definition
from studio.apps.visual_workshop.assistant_values import sse_frame
from studio.runtime.http.capability_client import CapabilityDenied, CapabilityUnavailable
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.tasks.reactive_tools.loop import ReactiveToolLoop
from studio.runtime.tasks.reactive_tools.types import AgentEvent, RunResult, RunStatus

RECHECK_SECONDS = 1.0
KEEPALIVE_SECONDS = 10.0


class AssistantStream:
    def __init__(self, state, turn, peers):
        self.state, self.turn = state, turn
        self.dispatches = state.assistant_dispatches
        self.started = monotonic()
        self.sequence = 0
        self.content = []
        self.first_token = None
        self.stopping = False
        self.finished = False
        self.queue = asyncio.Queue(maxsize=128)
        self.harness = build_harness(state, turn, peers)
        self.task = None

    def event(self, event_type, payload):
        data = sse_frame(event_type, self.sequence, payload)
        self.sequence += 1
        return data

    @property
    def run_id(self):
        return self.turn.scope.run_id

    async def check_authority(self):
        authority = await self.state.snapshot_authorization.status(
            assertion=self.turn.peer.assertion, method="POST", path=self.turn.peer.source
        )
        if authority is not True:
            raise ProjectResourceError(
                "助手访问已撤销" if authority is False else "助手授权暂不可核验",
                "assistant_authority_ended"
                if authority is False
                else "assistant_authority_unknown",
                401 if authority is False else 503,
            )

    async def listen(self, event):
        if not self.stopping:
            await self.queue.put(event)

    async def run(self):
        try:
            result = await self.harness.run(
                messages=list(self.turn.messages),
                user_text=self.turn.messages[-1].text,
                listener=self.listen,
            )
            await self.queue.put(result)
        except asyncio.CancelledError:
            if not self.stopping:
                await self.queue.put(CapabilityUnavailable("模型轮次已中断"))
            raise
        except Exception as exc:
            await self.queue.put(exc)

    async def stop(self):
        self.stopping = True
        await self.harness.abort()
        if self.task is not None:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task

    async def events(self):
        turn = self.turn
        try:
            await self.check_authority()
            self.task = asyncio.create_task(self.run())
            yield self.event(
                "start",
                {
                    "run_id": self.run_id,
                    "conversation_id": turn.scope.conversation_id,
                    "assistant_message_id": turn.message_id,
                    "turn_id": turn.turn_id,
                    "model": turn.model.model_slug,
                    "model_changed_from": turn.model_changed_from,
                    "agent_mode": "tools" if turn.model.tools_enabled else "advice",
                    "trace_id": turn.trace_id,
                    "revision": turn.revision,
                    "canvas_revision": turn.canvas_revision,
                    "attachment_warnings": list(turn.warnings),
                },
            )
            next_check = monotonic() + RECHECK_SECONDS
            next_keepalive = monotonic() + KEEPALIVE_SECONDS
            while True:
                remaining = next_check - monotonic()
                if remaining <= 0:
                    await self.check_authority()
                    next_check = monotonic() + RECHECK_SECONDS
                    if monotonic() >= next_keepalive:
                        yield b": keepalive\n\n"
                        next_keepalive = monotonic() + KEEPALIVE_SECONDS
                    continue
                try:
                    async with asyncio.timeout(remaining):
                        item = await self.queue.get()
                except TimeoutError:
                    continue
                if isinstance(item, AgentEvent):
                    for frame in await self.frames(item):
                        yield frame
                elif isinstance(item, RunResult):
                    await self.check_authority()
                    yield await self.complete(item)
                    return
                else:
                    raise item
        except (asyncio.CancelledError, GeneratorExit):
            with CancelScope(shield=True):
                await self.stop()
                if not self.finished:
                    await self.finalize(
                        status="cancelled",
                        run_status="cancelled",
                        reason="用户停止生成",
                        finish_reason="cancelled",
                        content="".join(self.content),
                    )
            raise
        except Exception as exc:
            await self.stop()
            code, title, detail = stream_failure(exc)
            yield await self.finalize(
                status="error",
                run_status="failed",
                reason=detail or title,
                finish_reason="error",
                content="".join(self.content),
                code=code,
                title=title,
                detail=detail,
            )
        finally:
            with CancelScope(shield=True):
                await self.stop()

    async def frames(self, event):
        turn = self.turn
        if event.type == "model_text_delta":
            text = str(event.payload.get("text") or "")
            if text and self.first_token is None:
                self.first_token = round((monotonic() - self.started) * 1000)
            self.content.append(text)
            return [self.event("delta", {"assistant_message_id": turn.message_id, "text": text})]
        if not event.type.startswith("tool_") and event.type not in {
            "approval_requested",
            "approval_resolved",
            "run_cancelled",
        }:
            return []
        actions = await persist_agent_event(
            self.state.database.sessions, turn.owner, turn.message_id, event
        )
        frames = [
            self.event(
                "step",
                {
                    "run_id": self.run_id,
                    "actions": [action.model_dump(mode="json") for action in actions],
                },
            )
        ]
        if event.type in {"approval_requested", "approval_resolved"}:
            kind = "approval_required" if event.type == "approval_requested" else event.type
            frames.append(self.event(kind, {"run_id": self.run_id, **event.payload}))
        elif event.type == "tool_completed":
            observation = event.payload.get("observation") or {}
            if "canvas_revision" in observation and "nodes" in observation:
                frames.append(
                    self.event(
                        "canvas_updated",
                        {
                            "canvas_revision": observation["canvas_revision"],
                            "nodes": observation["nodes"],
                        },
                    )
                )
            if isinstance(observation.get("task"), dict):
                frames.append(
                    self.event(
                        "generation_task_created",
                        {
                            "task": observation["task"],
                            "node": observation.get("node"),
                        },
                    )
                )
        return frames

    async def complete(self, result):
        ok = result.status == RunStatus.COMPLETED
        return await self.finalize(
            status="completed" if ok else "error",
            run_status=result.status.value,
            reason=None if ok else result.reason or "Agent 未完成本轮任务",
            finish_reason="stop" if ok else result.status.value,
            content=result.final_text,
            code=result.status.value,
        )

    async def finalize(
        self,
        *,
        status,
        run_status,
        reason,
        finish_reason,
        content,
        code=None,
        title=None,
        detail=None,
    ):
        turn = self.turn
        message, revision, outcome = await self.dispatches.finish(
            turn.owner,
            self.run_id,
            status=status,
            run_status=run_status,
            content=content,
            error=reason[:1000] if reason else None,
            finish_reason=finish_reason,
            first_token=self.first_token,
        )
        self.finished = True
        payload = {"run_id": self.run_id, "trace_id": turn.trace_id, "revision": revision}
        if message is not None and code != "assistant_authority_ended":
            payload["message_state"] = message.model_dump(mode="json")
        try:
            receipt = await self.dispatches.deliver(turn.owner, self.run_id, settlement=outcome)
            if receipt is None:
                raise CapabilityUnavailable("对话结算尚未确认")
        except CapabilityUnavailable:
            if code == "assistant_authority_ended":
                return self.event("error", {**payload, "code": code, "message": title or reason})
            return self.event(
                "error",
                {
                    **payload,
                    "code": "assistant_settlement_pending",
                    "message": "对话已保存，模型日志回执仍在恢复。",
                },
            )
        if status == "completed":
            payload["message"] = payload.pop("message_state")
            return self.event("done", {**payload, **receipt, "run_status": run_status})
        return self.event(
            "error",
            {
                **payload,
                "log_id": receipt["log_id"],
                "code": code or run_status,
                "message": title or reason,
                **({"detail": detail} if detail else {}),
            },
        )


def build_harness(state, turn, peers):
    reads = AssistantToolReads(state.database.sessions, peers, turn)
    canvas = AssistantCanvasActions(state, turn)
    generation = AssistantGenerationAction(state, turn)
    definition = build_visual_agent_definition(
        context_source=reads.context,
        handlers={
            "read_canvas": reads.read_canvas,
            "list_project_assets": reads.list_project_assets,
            "list_generation_options": reads.list_generation_options,
            "inspect_generation_task": reads.inspect_generation_task,
            "apply_canvas_changes": canvas.apply_canvas_changes,
            "start_generation_on_canvas": generation.start_generation_on_canvas,
        },
        model=turn.model.model_slug,
        tools_enabled=turn.model.tools_enabled,
        image_model_id=turn.image_model_id,
        image_model_slug=turn.image_model_slug,
        video_model_id=turn.video_model_id,
        video_model_slug=turn.video_model_slug,
    )
    return ReactiveToolLoop(
        adapter=turn.peer,
        definition=definition,
        scope={
            **turn.scope.model_dump(),
            "owner_user_id": turn.owner,
            "canvas_revision": turn.canvas_revision,
            "image_model_id": turn.image_model_id,
            "video_model_id": turn.video_model_id,
        },
        approvals=state.assistant_approvals,
        run_id=turn.scope.run_id,
    )


def stream_failure(exc):
    if isinstance(exc, (httpx.TimeoutException, TimeoutError)) or str(exc) == "model_turn_timeout":
        return "model_timeout", "模型调用超时", None
    if isinstance(exc, CapabilityDenied):
        return "assistant_authority_ended", "助手访问已撤销", None
    if isinstance(exc, ProjectResourceError):
        return exc.code, str(exc), None
    if isinstance(exc, CapabilityUnavailable):
        return "agent_failed", "Agent 运行失败", str(exc)[:1000]
    return "agent_failed", "Agent 运行失败", None
