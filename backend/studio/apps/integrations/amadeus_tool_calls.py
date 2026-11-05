"""Owned one-shot Tool API and MCP execution with exact inputs and live authorization."""

import asyncio

from anyio import CancelScope
from fastapi import HTTPException
from jsonschema import ValidationError
from sqlalchemy import select, text, update

from studio.apps.integrations.storage.models import McpIntegration, ToolApiIntegration
from studio.contracts.integrations.errors import IntegrationNotFoundError, IntegrationNotStarted
from studio.contracts.integrations.integration_intents import AmadeusToolOutcome
from studio.runtime.time import utc_now

from .records import AmadeusToolCall

UNKNOWN = AmadeusToolOutcome(
    status="unknown",
    result={"code": "integration_outcome_unknown", "message": "外部工具结果待核实"},
)


class ToolCall:
    def __init__(self, database, intents, intent_id, decision):
        self.database, self.intents, self.id = database, intents, intent_id
        self.actor, self.scope = decision.actor, decision.scope
        self.owner = self.actor.user_id

    async def live(self):
        model = McpIntegration if self.scope.kind == "mcp.call" else ToolApiIntegration
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            row = await session.get(model, self.scope.connection_id)
            if row is None or row.revision != self.scope.connection_revision or not row.enabled:
                raise IntegrationNotStarted("连接未启用或配置已经变化")
        decision = await self.intents.check(self.id)
        if not decision.allowed or decision.actor != self.actor or decision.scope != self.scope:
            raise HTTPException(403, "integration_authorization_revoked")

    async def claim(self):
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            row = await session.get(AmadeusToolCall, str(self.id))
            if row is not None:
                if row.status == "running":
                    return UNKNOWN
                return AmadeusToolOutcome(status=row.status, result=row.result)
            session.add(AmadeusToolCall(id=str(self.id), status="running", result={}))
            await session.commit()
        return None

    async def finish(self, outcome):
        async with self.database.sessions(info={"owner_user_id": self.owner}) as session:
            await session.execute(
                update(AmadeusToolCall)
                .where(AmadeusToolCall.id == str(self.id), AmadeusToolCall.status == "running")
                .values(status=outcome.status, result=outcome.result, updated_at=utc_now())
            )
            await session.commit()

    async def run(self, operation):
        existing = await self.claim()
        if existing is not None:
            return existing
        task = watcher = None
        dispatched = False
        try:
            await self.live()

            async def watch():
                while True:
                    await asyncio.sleep(1)
                    await self.live()

            task = asyncio.create_task(operation())
            watcher = asyncio.create_task(watch())
            done, _ = await asyncio.wait({task, watcher}, return_when=asyncio.FIRST_COMPLETED)
            if watcher in done:
                await watcher
            result = await task
            dispatched = True
            await self.live()
            outcome = AmadeusToolOutcome(status="completed", result=result)
        except (IntegrationNotStarted, IntegrationNotFoundError, ValidationError):
            outcome = (
                UNKNOWN
                if dispatched or (watcher is not None and watcher.done())
                else AmadeusToolOutcome(
                    status="failed",
                    result={"code": "integration_not_started", "message": "连接或输入不再有效"},
                )
            )
        except asyncio.CancelledError:
            with CancelScope(shield=True):
                await self.finish(UNKNOWN)
            raise
        except Exception:
            outcome = UNKNOWN
        finally:
            for pending in (task, watcher):
                if pending is not None and not pending.done():
                    pending.cancel()
            await asyncio.gather(
                *(item for item in (task, watcher) if item is not None), return_exceptions=True
            )
        await self.finish(outcome)
        return outcome


async def recover_tool_calls(database):
    model = AmadeusToolCall
    async with database.sessions(info={"allow_system_reads": True}) as session:
        owners = await session.scalars(
            select(model.owner_user_id).where(model.status == "running").distinct()
        )
    for owner in owners:
        async with database.sessions(info={"owner_user_id": owner}) as session:
            await session.execute(
                update(model)
                .where(model.status == "running")
                .values(status="unknown", result=UNKNOWN.result, updated_at=utc_now())
            )
            await session.commit()
