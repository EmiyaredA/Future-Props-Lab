"""One local Codex job at a time, with short transactions and stale-result fencing."""

from pydantic import ValidationError
from sqlalchemy import select, update

from app.console.governance.code_agents import authorized
from app.runtime.db import SessionLocal
from app.runtime.operation_receipts import OperationError
from app.runtime.ownership import bind_owner
from studio.apps.interview_assistant.bundles import acceptance
from studio.apps.interview_assistant.codex import CodexExecutor, task_context
from studio.apps.interview_assistant.executor_status import executor_status
from studio.apps.interview_assistant.storage.models import InterviewPreparation, InterviewRoom
from studio.contracts.interview_assistant.documents import PreparationBundle
from studio.runtime.tasks.polling import PollingTaskRunner
from studio.runtime.time import iso_utc, utc_now


class InterviewPreparationRunner(PollingTaskRunner):
    runner_name = "interview-preparation"
    poll_interval_seconds = 1.0

    def __init__(self, actor_allowed, executor=None, sessions=SessionLocal):
        super().__init__()
        self.actor_allowed = actor_allowed
        self.executor = executor or CodexExecutor()
        self.sessions = sessions

    async def recover(self):
        async with self.sessions() as session:
            await session.execute(
                update(InterviewPreparation)
                .where(InterviewPreparation.status.in_({"queued", "running", "validating"}))
                .values(
                    status="interrupted",
                    message="应用已重启，准备任务中断；请手动重试",
                    revision=InterviewPreparation.revision + 1,
                    updated_at=utc_now(),
                )
            )
            await session.commit()

    async def process_once(self):
        async with self.sessions() as session:
            identifier = await session.scalar(
                select(InterviewPreparation.id)
                .where(InterviewPreparation.status == "queued")
                .order_by(InterviewPreparation.created_at)
                .limit(1)
            )
        if identifier:
            await self.execute(identifier)

    async def active(self, task_id):
        async with self.sessions() as session:
            task = await session.get(InterviewPreparation, task_id)
            if not task or task.status not in {"running", "validating"}:
                return False
            bind_owner(session, task.owner_user_id)
            room = await session.get(InterviewRoom, task.room_id)
            return bool(
                room
                and room.active_task_id == task.id
                and await authorized(
                    session,
                    task.owner_user_id,
                    task.user_id,
                    "codex",
                    "interview_preparation",
                )
                and await self.actor_allowed(session, task.owner_user_id, task.user_id)
            )

    async def event(self, task_id, kind, message, urls=None):
        async with self.sessions() as session:
            row = await session.get(InterviewPreparation, task_id)
            if row is None or row.status not in {"running", "validating"}:
                return
            events = [
                *row.events,
                {
                    "sequence": len(row.events) + 1,
                    "kind": kind,
                    "message": message[:500],
                    "at": iso_utc(utc_now()),
                    "urls": urls or [],
                },
            ]
            if len(events) > 500:
                return
            await session.execute(
                update(InterviewPreparation)
                .where(
                    InterviewPreparation.id == row.id,
                    InterviewPreparation.revision == row.revision,
                    InterviewPreparation.status.in_({"running", "validating"}),
                )
                .values(
                    events=events,
                    message=message[:1000],
                    updated_at=utc_now(),
                    revision=InterviewPreparation.revision + 1,
                )
            )
            await session.commit()

    async def finish(self, task_id, status, message, bundle=None):
        async with self.sessions() as session:
            row = await session.get(InterviewPreparation, task_id)
            if not row or row.status not in {"running", "validating"}:
                return
            bind_owner(session, row.owner_user_id)
            room = await session.get(InterviewRoom, row.room_id)
            if not room or room.active_task_id != row.id:
                status, message = "interrupted", "已有更新的输入，旧任务结果不会替换本场资料"
            if status == "succeeded":
                changed = await session.execute(
                    update(InterviewRoom)
                    .where(
                        InterviewRoom.id == row.room_id,
                        InterviewRoom.active_task_id == row.id,
                        InterviewRoom.input_version == row.input_version,
                    )
                    .values(
                        active_bundle_id=row.id,
                        revision=InterviewRoom.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                if changed.rowcount != 1:
                    status, message = "interrupted", "输入版本已变化，未接收旧任务结果"
            result = await session.execute(
                update(InterviewPreparation)
                .where(
                    InterviewPreparation.id == row.id,
                    InterviewPreparation.status.in_({"running", "validating"}),
                    InterviewPreparation.revision == row.revision,
                )
                .values(
                    status=status,
                    message=message[:1000],
                    result=bundle,
                    revision=InterviewPreparation.revision + 1,
                    updated_at=utc_now(),
                )
            )
            if result.rowcount != 1:
                await session.rollback()
                return
            await session.commit()

    async def cancelled_process_stopped(self, task_id):
        async with self.sessions() as session:
            await session.execute(
                update(InterviewPreparation)
                .where(
                    InterviewPreparation.id == task_id, InterviewPreparation.status == "cancelled"
                )
                .values(
                    message="任务已取消，执行进程已停止",
                    updated_at=utc_now(),
                    revision=InterviewPreparation.revision + 1,
                )
            )
            await session.commit()

    async def execute(self, identifier):
        async with self.sessions() as session:
            result = await session.execute(
                update(InterviewPreparation)
                .where(
                    InterviewPreparation.id == identifier, InterviewPreparation.status == "queued"
                )
                .values(
                    status="running",
                    message="正在启动本机 Codex",
                    updated_at=utc_now(),
                    revision=InterviewPreparation.revision + 1,
                )
            )
            await session.commit()
            if result.rowcount != 1:
                return
            task = await session.get(InterviewPreparation, identifier)
            session.expunge(task)
        try:
            if not await self.active(identifier):
                raise OperationError("执行者权限或本机授权已变化", "executor_access", 403)
            status = await executor_status(task.user_id, task.owner_user_id)
            if not status.available:
                raise OperationError(status.message, status.code, 409)
            root = task_context(task)
            await self.event(identifier, "started", "已冻结 JD、简历原件与补充说明，正在交给 Codex")
            document, searches = await self.executor.run(
                task,
                root,
                lambda kind, message, urls=None: self.event(identifier, kind, message, urls),
                lambda: self.active(identifier),
            )
            if not await self.active(identifier):
                raise OperationError("任务已取消或授权已变化", "task_cancelled", 409)
            async with self.sessions() as session:
                await session.execute(
                    update(InterviewPreparation)
                    .where(
                        InterviewPreparation.id == identifier,
                        InterviewPreparation.status == "running",
                    )
                    .values(status="validating", revision=InterviewPreparation.revision + 1)
                )
                await session.commit()
            await self.event(identifier, "validating", "正在校验交付格式、原文依据和资料引用")
            bundle = PreparationBundle.model_validate(document)
            problems = acceptance(bundle, task.id, task.input_hash, root, searches)
            if problems:
                await self.finish(
                    identifier, "needs_input", "；".join(problems), bundle.model_dump(mode="json")
                )
            else:
                await self.event(
                    identifier,
                    "accepted",
                    "资料结构验收通过；来源内容仍需结合版本审阅",
                    [source.url for source in bundle.sources],
                )
                await self.finish(
                    identifier, "succeeded", "本场资料已准备完成", bundle.model_dump(mode="json")
                )
        except OperationError as exc:
            if exc.code == "task_cancelled":
                await self.cancelled_process_stopped(identifier)
            await self.finish(identifier, "failed", str(exc))
        except ValidationError:
            await self.finish(identifier, "failed", "Codex 返回的资料不符合约定格式，请重新准备")
        except Exception:
            await self.finish(
                identifier, "failed", "交付格式不合格或准备失败；请检查材料并手动重试"
            )
