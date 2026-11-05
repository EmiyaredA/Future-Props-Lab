"""Advance the owned Workbench FIFO using a live session proof held in memory."""

from time import time

from fastapi import HTTPException

from app.apps.agent_workbench.execution import transcripts, turn_records
from app.apps.agent_workbench.execution.models import WorkbenchTurn
from fpl_runtime.workbench_execution import queue_remove_path, queue_resume_path

from .execution_discovery import registered_project_root


class ExecutionQueue:
    def __init__(self, turns):
        self.turns = turns
        self.grants = {}

    def register(self, owner, chat, turn, grant):
        if len(self.grants) >= 256:
            raise HTTPException(503, "workbench_queue_capacity")
        self.grants[owner, chat, turn] = grant

    def forget_chat(self, owner, chat):
        for key in tuple(self.grants):
            if key[:2] == (owner, chat):
                del self.grants[key]

    async def change(self, db, owner, chat, assertion, *, local, session_id, remove=None):
        await transcripts.get_chat(db, owner, chat)
        await db.rollback()
        if remove is None:
            grant = await self.turns.issue_grant(
                assertion, queue_resume_path(chat), local, session_id
            )
        else:
            await self.turns.authority(assertion, queue_remove_path(chat, remove), method="DELETE")
        await turn_records.begin(db)
        current = await transcripts.get_chat(db, owner, chat)
        if remove is not None:
            row = await transcripts.get_turn(db, owner, chat, remove)
            if row.status == "removed":
                return
            if row.status != "queued":
                raise HTTPException(409, "此消息已开始执行")
            row.status, row.queued_session_id = "removed", None
            row.revision += 1
            await db.commit()
            self.grants.pop((owner, chat, remove), None)
            return
        active = await db.scalar(
            transcripts.chat_turns(owner, chat).where(WorkbenchTurn.status.in_(transcripts.ACTIVE))
        )
        if active:
            raise HTTPException(409, "请等待当前轮结束后继续队列")
        rows = (await db.scalars(transcripts.queued_turns(owner, chat))).all()
        ids = [row.id for row in rows]
        if sum(key[:2] != (owner, chat) for key in self.grants) + len(ids) > 256:
            raise HTTPException(503, "workbench_queue_capacity")
        for row in rows:
            row.queued_session_id, row.queued_local = session_id, local
        current.queue_paused = False
        await db.commit()
        self.forget_chat(owner, chat)
        self.grants.update({(owner, chat, identity): grant for identity in ids})

    async def advance(self, owner, chat):
        async with self.turns.session(owner) as db:
            current = await transcripts.get_chat(db, owner, chat)
            if current.queue_paused:
                self.forget_chat(owner, chat)
                return
            head = await transcripts.next_queued(db, owner, chat)
            if head is None:
                if not await db.scalar(transcripts.queued_turns(owner, chat).limit(1)):
                    self.forget_chat(owner, chat)
                return
            key = owner, chat, head.id
            existing = grant = self.grants.get(key)
            await db.rollback()
            if grant is not None:
                try:
                    await self.turns.verify_grant(grant)
                except HTTPException:
                    grant = None
            await turn_records.begin(db)
            head = await transcripts.next_queued(db, owner, chat)
            if head is None or head.id != key[2] or self.grants.get(key) != existing:
                return
            current = await transcripts.get_chat(db, owner, chat)
            if grant is None or (
                (head.queued_session_id, head.queued_local) != (grant.session_id, grant.local)
            ):
                current.queue_paused = True
                await db.commit()
                self.forget_chat(owner, chat)
                return
            if len(self.turns.grants) >= 32:
                return
            root = (
                await registered_project_root(db, owner, current.project_id)
                if grant.local
                else None
            )
            head.status, head.started_at = "running", int(time())
            head.queued_session_id = None
            head.revision += 1
            self.turns.stage_job(db, head, current, root, grant)
            await db.commit()
            self.grants.pop(key, None)

    async def advance_ready(self):
        if not self.turns.ready:
            return
        for owner, chat in dict.fromkeys(key[:2] for key in self.grants):
            await self.advance(owner, chat)
