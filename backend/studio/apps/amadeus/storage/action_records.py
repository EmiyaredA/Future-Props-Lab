"""Owned authorization, state transitions and settlement for Amadeus actions."""

from sqlalchemy import exists, select, update

from app.console.amadeus.conversations import Conversations, action_arguments_sha256
from app.console.amadeus.models import AmadeusAction, AmadeusRun
from app.console.amadeus.schemas import ActionOut
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.time import utc_now

ACTIVE_RUN = ("running", "waiting_approval")
WORK_FILES = frozenset({"write_work_file", "write_script"})


def action_out(row):
    return ActionOut(
        id=row.id,
        tool_name=row.tool_name,
        arguments=row.arguments_json,
        arguments_sha256=row.arguments_sha256,
        status=row.status,
        result=row.result_json,
        run_id=row.run_id,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


class ActionRecords:
    def __init__(self, session, principal, conversation):
        self.session, self.principal, self.conversation = session, principal, conversation

    async def get(self, action):
        row = await self.session.scalar(
            select(AmadeusAction).where(
                AmadeusAction.id == action,
                AmadeusAction.conversation_id == self.conversation,
                AmadeusAction.owner_user_id == self.principal.user_id,
                AmadeusAction.user_id == self.principal.user_id,
            )
        )
        if row is None:
            raise OperationError("操作不存在", "not_found", 404)
        return row

    async def claim(self, action, available):
        conversation = await Conversations(self.session, self.principal)._get(self.conversation)
        if conversation.executor_kind == "legacy-pi":
            raise OperationError("旧内核对话只读", "legacy_readonly", 409)
        row = await self.get(action)
        if (
            row.status != "approved"
            or action_arguments_sha256(row.arguments_json) != row.arguments_sha256
        ):
            raise OperationError("操作未获批准或已经执行", "approval_conflict", 409)
        name, run_id, checksum = row.tool_name, row.run_id, row.arguments_sha256
        external = name.startswith(("tool_api:", "mcp:"))
        recognized = (
            external or name in WORK_FILES or name in {"run_script", "video_timeline_batch"}
        )
        if not recognized and not name.startswith("fpl_operation:"):
            raise OperationError("工具不可执行", "unsupported_tool", 422)
        permission = "configuration.manage" if external else "content.write"
        if not self.principal.allows(permission):
            raise OperationError("操作权限不足", "insufficient_permission", 403)
        if not available(name):
            raise OperationError("操作执行器尚未就绪", "action_unavailable", 503)
        statement = update(AmadeusAction).where(
            AmadeusAction.id == action,
            AmadeusAction.conversation_id == self.conversation,
            AmadeusAction.status == "approved",
            AmadeusAction.arguments_sha256 == checksum,
        )
        if run_id:
            run = select(AmadeusRun.id).where(
                AmadeusRun.id == run_id,
                AmadeusRun.owner_user_id == self.principal.user_id,
                AmadeusRun.conversation_id == self.conversation,
                AmadeusRun.status.in_(ACTIVE_RUN),
            )
            statement = statement.where(exists(run))
        await self.session.rollback()
        result = await self.session.execute(
            statement.values(status="running", updated_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            if run_id and await self.session.scalar(run) is None:
                raise OperationError("运行已经结束，操作不可执行", "run_not_active", 409)
            raise OperationError("操作已经开始", "approval_conflict", 409)
        await self.session.commit()
        return action_out(await self.get(action))

    async def settle(self, action, status, result):
        await self.session.execute(
            update(AmadeusAction)
            .where(
                AmadeusAction.id == action,
                AmadeusAction.conversation_id == self.conversation,
                AmadeusAction.status == "running",
            )
            .values(status=status, result_json=result, updated_at=utc_now())
        )
        await self.session.commit()
        return action_out(await self.get(action))

    async def active(self):
        return (
            await self.session.scalar(
                select(AmadeusAction.id)
                .where(
                    AmadeusAction.conversation_id == self.conversation,
                    AmadeusAction.status == "running",
                )
                .limit(1)
            )
            is not None
        )


async def recover_actions(session):
    await session.execute(
        update(AmadeusAction)
        .where(AmadeusAction.status == "running")
        .values(
            status="unknown",
            result_json={"message": "后端重启，操作结果待核实"},
            updated_at=utc_now(),
        )
    )
    await session.commit()
