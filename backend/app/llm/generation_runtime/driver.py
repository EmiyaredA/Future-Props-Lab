from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection
from dataclasses import dataclass
from time import monotonic
from typing import Any, Protocol

from sqlalchemy import select, text, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.llm.generation_state import POLL_RETRY_PREFIX, cancel_queued, is_transient_poll_error
from app.llm.local_models.catalog import credential_ready
from app.llm.models import ModelProvider
from app.llm.task_execution import TaskExecutionInfo
from app.llm.task_outcomes import SUBMISSION_INTERRUPTED_MESSAGE, TaskClaimRejected
from app.runtime.credentials import decrypt_secret
from studio.runtime.database.ownership import require_owner_id
from studio.runtime.database.task_records import load_runner_task, recovery_accounts
from studio.runtime.time import utc_now


@dataclass(frozen=True, slots=True)
class GenerationTaskContext:
    task_id: str
    status: str
    provider_kind: str
    base_url: str
    api_key: str
    model_slug: str
    payload: dict[str, Any]
    provider_task_id: str
    result_url: str
    owner_user_id: str


class ProviderTaskStatus(Protocol):
    status: str
    progress: int
    result_url: str | None
    error_message: str | None
    execution_info: TaskExecutionInfo | None


@dataclass(frozen=True, slots=True)
class ImmediateGenerationResult:
    result_url: str


TerminalHook = Callable[[AsyncSession, Any], None]
SubmitHook = Callable[[GenerationTaskContext], Awaitable[str | ImmediateGenerationResult]]
PollHook = Callable[[GenerationTaskContext], Awaitable[ProviderTaskStatus]]
MaterializeHook = Callable[[str, str], Awaitable[None]]
ErrorMapper = Callable[[Exception], str]
ClaimAdmission = Callable[[AsyncSession, Any], Awaitable[bool]]
PrepareClaim = Callable[[str], Awaitable[ClaimAdmission | None]]
TerminalSettlement = Callable[[AsyncSession], Awaitable[Any]]


class GenerationTaskStore:
    """Short-transaction persistence adapter shared by generation features."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession],
        task_type: type[Any],
        active_statuses: Collection[str],
        task_subject: str,
        terminal_hook: TerminalHook | None = None,
        claim_admission: ClaimAdmission | None = None,
        prepare_claim: PrepareClaim | None = None,
        terminal_settlement: TerminalSettlement | None = None,
    ) -> None:
        self.session_factory = session_factory
        self.task_type = task_type
        self.active_statuses = frozenset(active_statuses)
        self.task_subject = task_subject
        self.terminal_hook = terminal_hook
        self.claim_admission = claim_admission
        self.prepare_claim = prepare_claim
        self.terminal_settlement = terminal_settlement

    async def load(self, session: AsyncSession, task_id: str) -> Any | None:
        return await load_runner_task(session, self.task_type, task_id, subject=self.task_subject)

    async def recover_submitting(self) -> None:
        owners = await recovery_accounts(
            self.session_factory, self.task_type, statuses=("submitting",)
        )
        for owner in owners:
            async with self.session_factory(info={"owner_user_id": owner}) as session:
                rows = list(
                    await session.scalars(
                        select(self.task_type).where(
                            self.task_type.owner_user_id == owner,
                            self.task_type.status == "submitting",
                        )
                    )
                )
                for row in rows:
                    row.status = "failed"
                    row.error_message = SUBMISSION_INTERRUPTED_MESSAGE
                    row.revision += 1
                    row.updated_at = utc_now()
                    await self._on_terminal(session, row)
                await session.commit()

    async def active_task_ids(
        self, *, limit: int = 40, statuses: Collection[str] | None = None
    ) -> list[str]:
        async with self.session_factory(info={"allow_system_reads": True}) as session:
            return list(
                (
                    await session.execute(
                        select(self.task_type.id)
                        .where(
                            self.task_type.status.in_(
                                statuses if statuses is not None else self.active_statuses
                            )
                        )
                        .order_by(self.task_type.updated_at)
                        .limit(limit)
                    )
                )
                .scalars()
                .all()
            )

    async def claim(self, task_id: str) -> GenerationTaskContext | None:
        # Identity/network work finishes before the SQLite writer transaction starts.
        prepared = await self.prepare_claim(task_id) if self.prepare_claim else None
        if self.prepare_claim is not None and prepared is None:
            return None
        async with self.session_factory() as session:
            if self.claim_admission is not None or prepared is not None:
                await session.execute(text("BEGIN IMMEDIATE"))
            task = await self.load(session, task_id)
            if task is None or task.status not in self.active_statuses:
                return None
            owner_user_id = require_owner_id(task.owner_user_id, subject=self.task_subject)
            status = task.status
            result_url = task.result_url or ""
            if status == "submitting" or (status == "processing" and result_url):
                context = self._context(task, owner_user_id=owner_user_id)
                await session.rollback()
                return context

            if status == "queued" and prepared is not None:
                try:
                    allowed = await prepared(session, task)
                except TaskClaimRejected as exc:
                    task.status = "failed"
                    task.error_message = str(exc)[:4000]
                    task.revision += 1
                    task.updated_at = utc_now()
                    await self._on_terminal(session, task)
                    await session.commit()
                    return None
                if not allowed:
                    await session.rollback()
                    return None

            provider = (
                await session.get(ModelProvider, task.provider_id) if task.provider_id else None
            )
            if (
                provider is None
                or provider.owner_user_id != owner_user_id
                or not provider.enabled
                or not credential_ready(provider)
            ):
                await session.rollback()
                raise ValueError("供应商已停用、删除或缺少 API Key")
            context = self._context(
                task,
                owner_user_id=owner_user_id,
                base_url=provider.base_url,
                api_key=decrypt_secret(provider.api_key_ciphertext)
                if provider.api_key_ciphertext
                else "",
            )
            if status == "queued":
                if self.claim_admission is not None and not await self.claim_admission(
                    session, task
                ):
                    await session.rollback()
                    return None
                claimed = await session.execute(
                    update(self.task_type)
                    .where(self.task_type.id == task_id, self.task_type.status == "queued")
                    .values(
                        status="submitting",
                        revision=self.task_type.revision + 1,
                        updated_at=utc_now(),
                    )
                )
                if claimed.rowcount != 1:
                    await session.rollback()
                    return None
                await session.commit()
            else:
                await session.rollback()
            return context

    async def mark_submitted(self, task_id: str, provider_task_id: str) -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status != "submitting":
                return
            task.provider_task_id = provider_task_id
            if hasattr(task, "submitted_at"):
                task.submitted_at = utc_now()
            task.status = "pending"
            task.progress = 0
            task.error_message = None
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def mark_materializing(self, task_id: str, result_url: str) -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status not in self.active_statuses:
                return
            task.status = "processing"
            task.progress = 100
            task.result_url = result_url
            task.error_message = None
            if task.execution_info is not None:
                task.execution_info = TaskExecutionInfo(
                    phase="finalizing", updated_at=utc_now()
                ).model_dump(mode="json")
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def mark_poll_error(self, task_id: str, message: str) -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status not in {"pending", "processing"}:
                return
            if not task.provider_task_id or task.result_url:
                return
            task.error_message = message
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def mark_progress(
        self,
        task_id: str,
        status: str,
        progress: int,
        execution_info: TaskExecutionInfo | None = None,
    ) -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status not in self.active_statuses:
                return
            task.status = "processing" if status == "processing" else "pending"
            task.progress = progress
            task.error_message = None
            if execution_info is not None:
                task.execution_info = execution_info.model_dump(mode="json")
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status in {"completed", "failed", "cancelled"}:
                return
            values = {
                "status": "failed",
                "error_message": message[:4000],
                "revision": self.task_type.revision + 1,
                "updated_at": utc_now(),
            }
            if result_url:
                values["result_url"] = result_url
            changed = await session.execute(
                update(self.task_type)
                .where(
                    self.task_type.id == task_id,
                    self.task_type.status.in_(self.active_statuses),
                )
                .values(**values)
            )
            if changed.rowcount != 1:
                await session.rollback()
                return
            await session.refresh(task)
            await self._on_terminal(session, task)
            await session.commit()

    def _context(
        self,
        task: Any,
        *,
        owner_user_id: str,
        base_url: str = "",
        api_key: str = "",
    ) -> GenerationTaskContext:
        return GenerationTaskContext(
            task_id=task.id,
            status=task.status,
            provider_kind=task.provider_kind,
            base_url=base_url,
            api_key=api_key,
            model_slug=task.model_slug,
            payload=dict(task.request_payload or {}),
            provider_task_id=task.provider_task_id or "",
            result_url=task.result_url or "",
            owner_user_id=owner_user_id,
        )

    async def _on_terminal(self, session: AsyncSession, task: Any) -> None:
        if self.terminal_hook is not None:
            self.terminal_hook(session, task)
        if self.terminal_settlement is not None:
            await self.terminal_settlement(session)


class GenerationTaskDriver:
    """Provider-neutral state machine for durable asynchronous generation tasks."""

    def __init__(
        self,
        *,
        store: GenerationTaskStore,
        submit: SubmitHook,
        poll: PollHook,
        materialize: MaterializeHook,
        map_error: ErrorMapper,
        provider_failure_message: str = "供应商生成任务失败",
        missing_result_message: str = "供应商已完成任务但未返回结果地址",
    ) -> None:
        self.store = store
        self.submit = submit
        self.poll = poll
        self.materialize = materialize
        self.map_error = map_error
        self.provider_failure_message = provider_failure_message
        self.missing_result_message = missing_result_message
        self._poll_retries: dict[str, tuple[float, int]] = {}

    @staticmethod
    async def cancel_queued(session: AsyncSession, task: Any, revision: int) -> bool:
        return await cancel_queued(session, task, revision)

    async def recover(self) -> None:
        await self.store.recover_submitting()

    async def process(self, task_id: str) -> None:
        retry = self._poll_retries.get(task_id)
        if retry is not None and monotonic() < retry[0]:
            return
        try:
            task = await self.store.claim(task_id)
            if task is None or task.status == "submitting":
                self._poll_retries.pop(task_id, None)
                return
            if task.status == "processing" and task.result_url:
                await self.materialize(task.task_id, task.result_url)
                return
            if task.status == "queued":
                provider_task_id = await self.submit(task)
                if isinstance(provider_task_id, ImmediateGenerationResult):
                    await self.store.mark_materializing(task.task_id, provider_task_id.result_url)
                    await self.materialize(task.task_id, provider_task_id.result_url)
                    return
                await self.store.mark_submitted(task.task_id, provider_task_id)
                return
            if not task.provider_task_id:
                raise ValueError("供应商任务编号缺失")

            try:
                provider_status = await self.poll(task)
            except Exception as exc:
                if not is_transient_poll_error(exc):
                    raise
                failures = retry[1] + 1 if retry else 1
                delay = min(5 * 2 ** min(failures - 1, 4), 60)
                message = f"{POLL_RETRY_PREFIX}（{type(exc).__name__}）；将重查原任务"
                await self.store.mark_poll_error(task_id, message)
                self._poll_retries[task_id] = (monotonic() + delay, failures)
                return
            self._poll_retries.pop(task_id, None)
            if provider_status.status == "failed":
                message = (
                    self.map_error(ValueError(provider_status.error_message))
                    if provider_status.error_message
                    else self.provider_failure_message
                )
                await self.store.fail(task.task_id, message)
                return
            if provider_status.status == "completed":
                if not provider_status.result_url:
                    await self.store.fail(task.task_id, self.missing_result_message)
                    return
                await self.store.mark_materializing(task.task_id, provider_status.result_url)
                await self.materialize(task.task_id, provider_status.result_url)
                return
            await self.store.mark_progress(
                task.task_id,
                provider_status.status,
                provider_status.progress,
                execution_info=getattr(provider_status, "execution_info", None),
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            self._poll_retries.pop(task_id, None)
            await self.store.fail(task_id, self.map_error(exc))
