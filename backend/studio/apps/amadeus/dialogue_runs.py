"""Own CLI turns, local tool effects and durable event settlement in Amadeus."""

import asyncio
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import select, update

from studio.apps.amadeus.rules.dialogue_prompt import dialogue_prompt
from studio.apps.amadeus.storage.files import work_root
from studio.apps.amadeus.storage.models import AmadeusAction
from studio.apps.amadeus.storage.runs import RunRecords
from studio.apps.amadeus.storage.skill_files import skill_root
from studio.contracts.amadeus.amadeus_native import DialogueScope
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.time import utc_now

from .dialogue_tools import DialogueTools
from .skill_pins import SkillSource, load_pin


class DialogueTurn:
    def __init__(self, database, principal, run, tools, prompt):
        self.database, self.principal, self.run = database, principal, run
        self.tools, self.prompt = tools, prompt
        self.lock = asyncio.Lock()

    def session(self):
        return self.database.sessions(info={"owner_user_id": self.principal.user_id})

    async def require_running(self):
        async with self.session() as session:
            current = await RunRecords(session, self.principal).get(
                self.run.conversation_id, self.run.id
            )
            if current.status != "running":
                raise HTTPException(410, "dialogue_run_ended")

    async def append(self, event):
        async with self.lock, self.session() as session:
            await RunRecords(session, self.principal).append_event(
                self.run.conversation_id, self.run.id, event
            )

    async def call(self, name, arguments):
        async with self.lock:
            return await self.tools.call(name, arguments)


class DialogueRuns:
    def __init__(self, database, identity, capabilities, host, actions, locks):
        self.database, self.identity, self.capabilities = database, identity, capabilities
        self.host, self.actions, self.locks = host, actions, locks
        self.tasks = {}

    async def create(self, session, principal, conversation, body, *, assertion, path):
        if self.host is None or not self.host.dialogue_ready:
            raise OperationError("Agent 连接尚未就绪", "agent_unavailable", 503)
        status = await self.identity.status(assertion=assertion, method="POST", path=path)
        if status is not True:
            raise OperationError(
                "运行授权不可用", "agent_not_authorized", 503 if status is None else 403
            )
        async with self.locks.setdefault((principal.user_id, conversation), asyncio.Lock()):
            detail = await RunRecords(
                session,
                principal,
                resolve_agent=self.host.connection,
                connection_field="agent_connection_signature",
            ).create(conversation, body)
            key = principal.user_id, conversation, detail.run.id
            task = asyncio.create_task(
                self.execute(principal, detail.run, assertion, path),
                name=f"amadeus:{detail.run.id}",
            )
            self.tasks[key] = task
            task.add_done_callback(lambda _task: self.tasks.pop(key, None))
        return detail

    async def prepare(self, principal, run, assertion, path):
        owner, conversation = principal.user_id, run.conversation_id
        skills = {}
        async with self.locks.setdefault((owner, conversation), asyncio.Lock()):
            directory = work_root(owner, conversation, files_root=self.database.root)
            await asyncio.to_thread(directory.mkdir, mode=0o700, parents=True, exist_ok=True)
            for selected in dict.fromkeys(run.capabilities):
                if selected.startswith("skill:"):
                    identity = selected.removeprefix("skill:")
                    root = skill_root(owner, conversation, identity, files_root=self.database.root)
                    source = SkillSource(self.capabilities, assertion, path, identity)
                    skills[identity] = await load_pin(root, source)
        if skills:
            async with self.database.sessions(info={"owner_user_id": owner}) as session:
                await RunRecords(session, principal).store_skill_snapshots(
                    conversation, run.id, skills
                )
        return DialogueTurn(
            self.database,
            principal,
            run,
            DialogueTools(
                self.database, self.capabilities, principal, run, assertion, path, skills
            ),
            dialogue_prompt(run, skills),
        )

    async def execute(self, principal, run, assertion, path):
        status, error = "failed", "Agent 运行失败，请检查连接与权限"
        try:
            turn = await self.prepare(principal, run, assertion, path)
            scope = DialogueScope(
                conversation_id=UUID(run.conversation_id),
                run_id=UUID(run.id),
                agent=run.agent_id,
                model=run.agent_model,
                **run.cli_options(),
                signature=run.execution_config["agent_connection_signature"],
            )
            outcome = await self.host.dialogue(principal.user_id, scope, assertion, path, turn)
            if outcome["status"] == "completed":
                status, error = "completed", None
            elif outcome["status"] == "unknown":
                status, error = "interrupted", "Agent 运行结果待核实"
            elif outcome["message"]:
                error = outcome["message"]
        except asyncio.CancelledError:
            status, error = "interrupted", "运行已停止，未确认结果需核实"
        except OperationError as exc:
            error = str(exc)
        except HTTPException as exc:
            if exc.detail == "amadeus_native_outcome_unconfirmed":
                status, error = "interrupted", "Agent 运行结果待核实"
        except (OSError, ValueError, TypeError) as exc:
            if isinstance(exc, ValueError):
                error = str(exc)[:1000]
        async with self.database.sessions(info={"owner_user_id": principal.user_id}) as session:
            records = RunRecords(session, principal)
            current = await records.get(run.conversation_id, run.id)
            if current.status == "cancelling":
                status, error = "cancelled", None
            return await records.finish(run.conversation_id, run.id, status, error)

    async def cancel(self, principal, conversation, identity, *, assertion, path):
        await self.actions.require_authority(assertion, path)
        owner = principal.user_id
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            records = RunRecords(session, principal)
            await records.mark_cancelling(conversation, identity)
            actions = list(
                await session.scalars(
                    select(AmadeusAction.id).where(
                        AmadeusAction.conversation_id == conversation,
                        AmadeusAction.run_id == identity,
                        AmadeusAction.status == "running",
                    )
                )
            )
            await session.execute(
                update(AmadeusAction)
                .where(
                    AmadeusAction.conversation_id == conversation,
                    AmadeusAction.run_id == identity,
                    AmadeusAction.status.in_(("pending", "approved")),
                )
                .values(
                    status="cancelled",
                    result_json={"message": "运行已停止，操作未执行"},
                    updated_at=utc_now(),
                )
            )
            await session.commit()
        for action in actions:
            try:
                await self.actions.cancel(
                    principal, conversation, action, assertion=assertion, path=path
                )
            except OperationError as exc:
                if exc.code != "action_not_running":
                    raise
        task = self.tasks.get((owner, conversation, identity))
        if task is not None:
            if not task.cancelling():
                task.cancel()
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError:
                if not task.cancelled():
                    raise
        async with self.database.sessions(info={"owner_user_id": owner}) as session:
            return await RunRecords(session, principal).finish(
                conversation, identity, "cancelled", None
            )

    async def close(self):
        tasks = tuple(self.tasks.values())
        for task in tasks:
            if not task.cancelling():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
