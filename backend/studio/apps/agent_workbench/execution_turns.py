"""Own turn submission, Mac leases and browser decisions without storing credentials."""

import asyncio
from dataclasses import dataclass, field, replace
from datetime import timedelta
from time import monotonic, time

from fastapi import HTTPException

from studio.apps.agent_workbench.execution import transcripts, turn_activity, turn_records
from studio.apps.agent_workbench.storage.service_models import WorkbenchExecutionJob
from studio.contracts.agent_workbench.execution import RUN_TURN, TurnScope, decision_path, turn_path
from studio.runtime.tasks.native_queue import NativeQueue, digest
from studio.runtime.time import utc_now

from .execution_discovery import registered_project_root
from .execution_instructions import ExecutionInstructions
from .execution_queue import ExecutionQueue

OPERATIONS = frozenset({RUN_TURN})
MAX_TURN_SECONDS = 900


@dataclass(frozen=True)
class TurnGrant:
    assertion: str = field(repr=False)
    path: str
    session_id: str
    local: bool
    expires: float


class ExecutionTurns:
    def __init__(self, database, identity, discovery, *, settlement):
        self.database, self.identity, self.discovery = database, identity, discovery
        self.queue = NativeQueue(
            database, WorkbenchExecutionJob, operations=OPERATIONS, clock=utc_now
        )
        self.settlement = settlement
        self.grants = {}
        self.last_poll = None
        self.pending = ExecutionQueue(self)
        self.instructions = ExecutionInstructions(self)

    @property
    def ready(self):
        return self.last_poll is not None and monotonic() - self.last_poll <= 15

    def session(self, owner):
        return self.database.sessions(info={"owner_user_id": owner})

    async def authority(self, assertion, path, *, method="POST"):
        value = await self.identity.cloud_authority(assertion=assertion, method=method, path=path)
        if value is None:
            raise HTTPException(503, "workbench_authority_unavailable")
        if not value.active or not value.enabled or value.unlocked_until <= time():
            raise HTTPException(403, "请先验证管理员密码")

    async def issue_grant(self, assertion, path, local, session_id):
        await self.authority(assertion, path)
        return TurnGrant(assertion, path, session_id, local, monotonic() + MAX_TURN_SECONDS)

    async def verify_grant(self, grant):
        if grant.expires <= monotonic():
            raise HTTPException(410, "workbench_execution_lease_ended")
        await self.authority(grant.assertion, grant.path)

    def stage_job(self, db, turn, chat, root, grant):
        payload = TurnScope(
            project_id=chat.project_id,
            agent=chat.agent_id,
            local=grant.local,
            registered_root=root,
            chat_id=chat.id,
            turn_id=turn.id,
        ).model_dump(mode="json")
        db.add(
            WorkbenchExecutionJob(
                id=turn.id,
                owner_user_id=turn.owner_user_id,
                request_id=turn.id,
                operation=RUN_TURN,
                payload=payload,
                payload_sha256=digest({"operation": RUN_TURN, "payload": payload}),
            )
        )
        self.grants[turn.owner_user_id, turn.id] = replace(
            grant, expires=monotonic() + MAX_TURN_SECONDS
        )

    async def submit(self, db, owner, chat, body, assertion, *, local, session_id):
        await transcripts.get_chat(db, owner, chat)
        await db.rollback()
        grant = await self.issue_grant(assertion, turn_path(chat), local, session_id)
        await turn_records.begin(db)
        current = await transcripts.get_chat(db, owner, chat)
        root = await registered_project_root(db, owner, current.project_id) if local else None

        def stage(turn):
            if turn.status == "queued":
                self.pending.register(owner, chat, turn.id, grant)
            else:
                if not self.ready or len(self.grants) >= 32:
                    raise HTTPException(503, "workbench_execution_worker_unavailable")
                self.stage_job(db, turn, current, root, grant)

        result, _created = await turn_records.store_turn(
            db, owner, chat, body, local=local, session_id=session_id, stage=stage
        )
        return result

    async def claim(self, worker):
        self.last_poll = monotonic()
        return await self.queue.claim(worker_id=worker, allowed_operations=OPERATIONS)

    async def live(self, worker, lease):
        if lease.operation != RUN_TURN:
            raise HTTPException(403, "workbench_execution_operation_forbidden")
        await self.discovery.lease(worker, lease, active=True)
        scope = TurnScope.model_validate(lease.payload)
        owner = lease.owner_user_id
        key = owner, scope.turn_id
        grant = self.grants.get(key)
        if grant is None:
            raise HTTPException(410, "workbench_execution_lease_ended")
        await self.verify_grant(grant)
        if self.grants.get(key) != grant:
            raise HTTPException(403, "workbench_authority_revoked")
        return scope

    async def owned_turn(self, db, owner, scope):
        chat = await transcripts.get_chat(db, owner, scope.chat_id)
        root = await registered_project_root(db, owner, scope.project_id) if scope.local else None
        if (chat.project_id, chat.agent_id, root) != (
            scope.project_id,
            scope.agent,
            scope.registered_root,
        ):
            raise HTTPException(410, "workbench_project_changed")
        turn = await transcripts.get_turn(db, owner, scope.chat_id, scope.turn_id)
        if turn.status not in {"running", "waiting_approval"}:
            raise HTTPException(410, "workbench_turn_ended")
        return turn

    async def heartbeat(self, worker, lease):
        scope = await self.live(worker, lease)
        async with self.session(lease.owner_user_id) as db:
            await turn_records.begin(db)
            await self.owned_turn(db, lease.owner_user_id, scope)
            job = await db.get(WorkbenchExecutionJob, str(lease.job_id))
            now = utc_now()
            if (
                job is None
                or job.status != "leased"
                or job.lease_id != str(lease.lease_id)
                or job.worker_id != worker
                or job.lease_expires_at <= now
            ):
                raise HTTPException(410, "workbench_execution_lease_ended")
            job.lease_expires_at = now + timedelta(seconds=90)
            job.revision += 1
            await db.commit()
        self.last_poll = monotonic()

    async def conversation(self, worker, lease):
        scope = await self.live(worker, lease)
        async with self.session(lease.owner_user_id) as db:
            current = await self.owned_turn(db, lease.owner_user_id, scope)
            turns = await transcripts.recent_turns(db, lease.owner_user_id, scope.chat_id, 12)
            return {
                "message": current.prompt,
                "history": [
                    {
                        "user": row.prompt,
                        "assistant": row.answer,
                        "status": row.status,
                        "instructions": [
                            x.text for x in row.instructions if x.status == "accepted"
                        ],
                    }
                    for row in turns
                    if row.position < current.position
                ],
            }

    async def answer(self, worker, lease, text):
        scope = await self.live(worker, lease)
        async with self.session(lease.owner_user_id) as db:
            await turn_records.begin(db)
            row = await self.owned_turn(db, lease.owner_user_id, scope)
            if text == row.answer:
                return
            if not text.startswith(row.answer):
                raise HTTPException(409, "workbench_answer_conflict")
            row.answer = text
            row.revision += 1
            await db.commit()

    async def activity(self, worker, body):
        payload = body.payload
        if not isinstance(payload.get("tool_call_id"), str) or (
            body.kind == "tool_call" and not isinstance(payload.get("tool_name"), str)
        ):
            raise HTTPException(422, "workbench_activity_invalid")
        scope = await self.live(worker, body.lease)
        async with self.session(body.lease.owner_user_id) as db:
            await turn_records.begin(db)
            row = await self.owned_turn(db, body.lease.owner_user_id, scope)
            if turn_activity.apply_activity(row, body.kind, payload):
                await db.commit()

    async def approval(self, worker, body, phase):
        scope = await self.live(worker, body.lease)
        owner = body.lease.owner_user_id
        async with self.session(owner) as db:
            await turn_records.begin(db)
            row = await self.owned_turn(db, owner, scope)
            item = next((x for x in row.approvals if x["id"] == body.approval_id), None)
            if item is not None and item.get("action_sha256") != body.action_sha256:
                raise HTTPException(409, "workbench_approval_effect_changed")
            if phase == "propose":
                proposal = {
                    "id": body.approval_id,
                    "kind": body.kind,
                    "title": body.title,
                    "preview": body.preview,
                    "action_sha256": body.action_sha256,
                }
                if item is not None:
                    if any(item.get(k) != v for k, v in proposal.items()):
                        raise HTTPException(409, "workbench_approval_effect_changed")
                    return {"status": item["status"]}
                try:
                    turn_records.stage_approval(row, proposal)
                except ValueError as exc:
                    raise HTTPException(409, str(exc)) from None
                await db.commit()
                return {"status": "pending"}
            if item is None:
                raise HTTPException(410, "workbench_approval_ended")
            status = item["status"]
            if phase == "reserve":
                if status == "pending":
                    return {"status": status}
                if row.status != "waiting_approval" or status not in {"approved", "rejected"}:
                    raise HTTPException(409, "workbench_approval_ended")
                row.status = "running"
                status = "executing" if status == "approved" else "rejected"
            elif status == body.status:
                return {"status": status}
            elif status == "executing":
                status = body.status
            else:
                raise HTTPException(409, "workbench_approval_ended")
            turn_records.change_approval(row, body.approval_id, status)
            await db.commit()
            return {"status": status}

    async def decide(self, db, owner, chat, turn, approval, approved, assertion, *, local):
        row = await transcripts.get_turn(db, owner, chat, turn)
        if turn_records.approval_status(row, approval) is None:
            raise HTTPException(404, "审批不存在")
        await db.rollback()
        await self.authority(assertion, decision_path(chat, turn, approval))
        grant = self.grants.get((owner, turn))
        if grant is None or grant.local != local or grant.expires <= monotonic():
            raise HTTPException(409, "审批已处理或失效")
        await turn_records.begin(db)
        await turn_records.record_decision(db, owner, chat, turn, approval, approved)

    async def stop(self, db, owner, chat, turn):
        await turn_records.begin(db)
        row = await transcripts.get_turn(db, owner, chat, turn)
        if row.status not in transcripts.ACTIVE:
            return
        (await transcripts.get_chat(db, owner, chat)).queue_paused = True
        job = await db.get(WorkbenchExecutionJob, turn)
        if job is None or job.status == "queued":
            if job is not None:
                job.status = "failed"
                job.error_code = "workbench_cancelled"
                job.revision += 1
            transcripts.end_turn(row, "cancelled")
        elif row.status != "cancelling":
            row.status = "cancelling"
            row.revision += 1
        await db.commit()

    async def settle(self, worker, lease, outcome):
        await self.settlement.execute(worker, lease, outcome)
        scope = TurnScope.model_validate(lease.payload)
        # Also clean ephemeral handles after a replay of an already committed receipt.
        self.grants.pop((lease.owner_user_id, scope.turn_id), None)
        self.instructions.close_turn(lease.owner_user_id, scope.turn_id)

    async def sweep(self):
        for (owner, identity), grant in tuple(self.grants.items()):
            async with self.session(owner) as db:
                await turn_records.begin(db)
                job = await db.get(WorkbenchExecutionJob, identity)
                if job is None or job.status not in {"queued", "leased"}:
                    if job is not None or grant.expires <= monotonic():
                        self.grants.pop((owner, identity), None)
                        self.instructions.close_turn(owner, identity)
                    continue
                expired = grant.expires <= monotonic() or (
                    job.lease_expires_at is not None and job.lease_expires_at <= utc_now()
                )
                abandoned = job.status == "queued" and job.created_at < utc_now() - timedelta(
                    seconds=45
                )
                if expired or abandoned:
                    scope = TurnScope.model_validate(job.payload)
                    row = await transcripts.get_turn(db, owner, scope.chat_id, scope.turn_id)
                    if row.status in transcripts.ACTIVE:
                        status = "cancelled" if row.status == "cancelling" else "interrupted"
                        transcripts.end_turn(row, status, "运行已中断，请核对操作结果")
                        (await transcripts.get_chat(db, owner, scope.chat_id)).queue_paused = True
                    job.status = "unknown" if job.status == "leased" else "failed"
                    job.error_code = "workbench_execution_lease_ended"
                    job.revision += 1
                    await db.commit()
                    self.grants.pop((owner, identity), None)
                    self.instructions.close_turn(owner, identity)

    async def maintain(self):
        while True:
            await asyncio.sleep(1)
            await self.sweep()
            await self.pending.advance_ready()
