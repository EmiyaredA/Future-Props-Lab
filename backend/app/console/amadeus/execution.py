"""Backend-owned CLI runs. The window may reconnect without restarting work."""

import asyncio
import time

from app.capabilities.agents.cli.dialogue import run_dialogue
from app.console.amadeus.dialogue_prompt import dialogue_prompt
from app.console.amadeus.files import work_root
from app.console.amadeus.runs import Runs
from app.console.amadeus.schemas import RunEventIn, RunOut
from app.console.amadeus.skills import load_skill
from app.console.amadeus.tool_bridge import TOOLS, ToolBridge
from app.console.governance.code_agents import resolve
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from app.runtime.ids import new_id
from app.runtime.ownership import bind_owner


class OwnedRun(RunOut):
    owner_user_id: str
    user_id: str


class CodeAgentRuns:
    def __init__(self, sessions=SessionLocal):
        self.sessions, self.tasks = sessions, {}

    def start(self, app, headers, principal, run):
        run = OwnedRun(
            **run.model_dump(), owner_user_id=principal.owner_user_id, user_id=principal.user_id
        )
        task = asyncio.create_task(
            self.execute(app, dict(headers), principal, run), name=f"amadeus:{run.id}"
        )
        self.tasks[run.id] = task
        task.add_done_callback(lambda _: self.tasks.pop(run.id, None))

    async def cancel(self, identity):
        task = self.tasks.get(identity)
        if task:
            if not task.cancelling():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def close(self):
        tasks = list(self.tasks.values())
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)

    async def execute(self, app, headers, principal, run):
        pending_text = ""
        last_flush = 0.0
        event_lock = asyncio.Lock()

        async def persist(kind, payload, *, check_authority=True):
            async with self.sessions() as session:
                bind_owner(session, run.owner_user_id)
                if check_authority:
                    await resolve(
                        session,
                        run.owner_user_id,
                        run.user_id,
                        run.agent_id,
                        "amadeus",
                        probe=False,
                    )
                current = await Runs(session, principal).get(run.conversation_id, run.id)
                if current.status not in {"running", "cancelling"}:
                    return
                await Runs(session, principal).append_event(
                    run.conversation_id,
                    run.id,
                    RunEventIn(kind=kind, payload=payload, idempotency_key=new_id()),
                )

        async def emit(kind, payload):
            nonlocal pending_text, last_flush
            async with event_lock:
                if kind == "assistant_delta":
                    if not payload.get("text"):
                        return
                    pending_text += payload.get("text", "")
                    if time.monotonic() - last_flush < 0.15:
                        return
                if pending_text:
                    text = pending_text
                    pending_text = ""
                    await persist("assistant_delta", {"text": text})
                    last_flush = time.monotonic()
                if kind != "assistant_delta":
                    await persist(kind, payload)

        bridge = ToolBridge(app, headers, principal, run, self.sessions)
        transport = None
        paused = None
        status, error = "completed", None
        try:
            async with self.sessions() as session:
                bind_owner(session, run.owner_user_id)
                path = await resolve(
                    session, run.owner_user_id, run.user_id, run.agent_id, "amadeus"
                )
                if path != run.execution_config.get("executable"):
                    raise ValueError("Agent 连接已变更，请手动新建运行")
            skill_snapshots = {}
            for selected in run.capabilities:
                if selected.startswith("skill:"):
                    async with self.sessions() as session:
                        bind_owner(session, run.owner_user_id)
                        identity = selected.removeprefix("skill:")
                        skill_snapshots[identity] = await load_skill(
                            session, run.owner_user_id, run.conversation_id, identity
                        )
            if skill_snapshots:
                async with self.sessions() as session:
                    bind_owner(session, run.owner_user_id)
                    current = await Runs(session, principal).get(run.conversation_id, run.id)
                    if current.status != "running":
                        return
                    current.execution_config = {
                        **current.execution_config,
                        "skills": skill_snapshots,
                    }
                    await session.commit()
            root = work_root(run.owner_user_id, run.conversation_id)
            if root.is_symlink():
                raise ValueError("会话目录不安全")
            root.mkdir(parents=True, exist_ok=True, mode=0o700)
            prompt = dialogue_prompt(run, skill_snapshots)
            transport = asyncio.create_task(
                run_dialogue(
                    run.agent_id,
                    path,
                    run.agent_model,
                    prompt,
                    TOOLS,
                    bridge.call,
                    emit,
                    root=root,
                    runtime_path=get_settings().runtime_path,
                )
            )
            paused = asyncio.create_task(bridge.paused.wait())
            done, _ = await asyncio.wait(
                [transport, paused], timeout=900, return_when=asyncio.FIRST_COMPLETED
            )
            if not done:
                raise TimeoutError("运行超过 15 分钟；请核实结果后手动继续")
            if bridge.paused.is_set():
                return
            await transport
        except asyncio.CancelledError:
            status, error = "interrupted", "运行已停止；未知结果不会自动重试"
            async with self.sessions() as session:
                bind_owner(session, run.owner_user_id)
                current = await Runs(session, principal).get(run.conversation_id, run.id)
                if current.status == "cancelling":
                    status = "cancelled"
        except Exception as exc:
            status = "failed"
            error = (
                str(exc)[:1000]
                if isinstance(exc, (ValueError, TimeoutError))
                else "Agent 运行失败，请检查连接与权限"
            )
            if isinstance(exc, OSError):
                error = f"Agent 本机连接失败：{exc.strerror}"
        finally:

            async def settle():
                nonlocal status, error
                for task in (transport, paused):
                    if task and not task.done() and not task.cancelling():
                        task.cancel()
                await asyncio.gather(*(t for t in (transport, paused) if t), return_exceptions=True)
                bridge.close()
                if pending_text:
                    try:
                        await persist(
                            "assistant_delta", {"text": pending_text}, check_authority=False
                        )
                    except Exception:
                        status, error = "failed", "未能保存回复尾部；请核对已保存的结果后手动继续"
                async with self.sessions() as session:
                    bind_owner(session, run.owner_user_id)
                    await Runs(session, principal).finish(
                        run.conversation_id, run.id, status, error
                    )

            # A second Stop/shutdown must not interrupt process, socket or DB cleanup.
            closing = asyncio.create_task(settle())
            while not closing.done():
                try:
                    await asyncio.shield(closing)
                except asyncio.CancelledError:
                    continue
            await closing


def runtime(app):
    return app.state.code_agent_runs
