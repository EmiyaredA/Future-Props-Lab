"""Short transactions for the compatibility website's action records."""

from sqlalchemy import exists, select, update

from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.time import utc_now

from .action_records import WORK_FILES, action_out
from .conversations import action_arguments_sha256
from .models import AmadeusAction, AmadeusConversation, AmadeusRun

BUILT_IN = WORK_FILES | {"run_script", "video_timeline_batch"}


class WebsiteActionRecords:
    def __init__(self, sessions, principal, conversation, resolve_agent):
        self.sessions, self.principal = sessions, principal
        self.conversation, self.resolve_agent = conversation, resolve_agent

    def session(self):
        return self.sessions(info={"owner_user_id": self.principal.owner_user_id})

    def scope(self, action):
        return (
            AmadeusAction.id == action,
            AmadeusAction.conversation_id == self.conversation,
            AmadeusAction.owner_user_id == self.principal.owner_user_id,
            AmadeusAction.user_id == self.principal.user_id,
        )

    async def claim(self, action_id):
        principal, conversation_id = self.principal, self.conversation
        async with self.session() as session:
            owner = await session.scalar(
                select(AmadeusConversation).where(
                    AmadeusConversation.id == conversation_id,
                    AmadeusConversation.owner_user_id == principal.owner_user_id,
                    AmadeusConversation.user_id == principal.user_id,
                )
            )
            if owner is None:
                raise OperationError("对话不存在", "not_found", 404)
            if owner.executor_kind == "legacy-pi":
                raise OperationError("旧内核对话只读", "legacy_readonly", 409)
            row = await session.scalar(
                select(AmadeusAction).where(
                    *self.scope(action_id),
                )
            )
            if row is None:
                raise OperationError("操作不存在", "not_found", 404)
            if (
                row.status != "approved"
                or action_arguments_sha256(row.arguments_json) != row.arguments_sha256
            ):
                raise OperationError("操作未获批准或已经执行", "approval_conflict", 409)
            if row.run_id:
                source_run = await session.get(AmadeusRun, row.run_id)
                if source_run and source_run.agent_id:
                    await self.resolve_agent(
                        session,
                        principal.owner_user_id,
                        principal.user_id,
                        source_run.agent_id,
                        probe=False,
                    )
                active_run = select(AmadeusRun.id).where(
                    AmadeusRun.id == row.run_id,
                    AmadeusRun.conversation_id == conversation_id,
                    AmadeusRun.owner_user_id == principal.owner_user_id,
                    AmadeusRun.user_id == principal.user_id,
                    AmadeusRun.status.in_(("running", "waiting_approval")),
                )
                if await session.scalar(active_run) is None:
                    raise OperationError("运行已经结束，操作不可执行", "run_not_active", 409)
            name = row.tool_name
            if (
                not name.startswith(("tool_api:", "mcp:", "fpl_operation:"))
                and name not in BUILT_IN
            ):
                raise OperationError("工具不可执行", "unsupported_tool", 422)
            if name.startswith(("tool_api:", "mcp:")) and not principal.allows(
                "configuration.manage"
            ):
                raise OperationError("没有外部工具执行权限", "insufficient_permission", 403)
            if (name in BUILT_IN or name.startswith("fpl_operation:")) and not principal.allows(
                "content.write"
            ):
                raise OperationError("没有脚本执行权限", "insufficient_permission", 403)
            snapshot = action_out(row)
            statement = update(AmadeusAction).where(
                *self.scope(action_id),
                AmadeusAction.status == "approved",
                AmadeusAction.arguments_sha256 == snapshot.arguments_sha256,
            )
            if snapshot.run_id:
                statement = statement.where(exists(active_run))
            await session.rollback()
            claimed = await session.execute(
                statement.values(status="running", updated_at=utc_now())
            )
            if claimed.rowcount != 1:
                raise OperationError("操作已经开始", "approval_conflict", 409)
            await session.commit()
            return snapshot

    async def read(self, action):
        async with self.session() as session:
            row = await session.scalar(select(AmadeusAction).where(*self.scope(action)))
            if row is None:
                raise OperationError("操作不存在", "not_found", 404)
            return action_out(row)

    async def settle(self, action, status, result):
        async with self.session() as session:
            await session.execute(
                update(AmadeusAction)
                .where(*self.scope(action), AmadeusAction.status == "running")
                .values(status=status, result_json=result, updated_at=utc_now())
            )
            await session.commit()
        return await self.read(action)

    async def cancel_pending(self, run):
        async with self.session() as session:
            scope = (
                AmadeusAction.run_id == run,
                AmadeusAction.conversation_id == self.conversation,
                AmadeusAction.owner_user_id == self.principal.owner_user_id,
                AmadeusAction.user_id == self.principal.user_id,
            )
            await session.execute(
                update(AmadeusAction)
                .where(*scope, AmadeusAction.status.in_(("pending", "approved")))
                .values(
                    status="cancelled",
                    result_json={"message": "运行已停止，操作未执行"},
                    updated_at=utc_now(),
                )
            )
            active = list(
                await session.scalars(
                    select(AmadeusAction.id).where(*scope, AmadeusAction.status == "running")
                )
            )
            await session.commit()
        return active
