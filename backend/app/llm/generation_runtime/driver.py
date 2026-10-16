from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable, Collection
from dataclasses import dataclass
from typing import Any, Protocol

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.llm.models import ModelProvider
from app.orm import bind_workspace, require_workspace_id
from app.runtime.credentials import decrypt_secret
from app.runtime.time import utc_now

SUBMISSION_INTERRUPTED_MESSAGE = "应用在提交供应商任务期间中断；为避免重复计费，请重新生成"


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
    workspace_id: str


class ProviderTaskStatus(Protocol):
    status: str
    progress: int
    result_url: str | None
    error_message: str | None


@dataclass(frozen=True, slots=True)
class ImmediateGenerationResult:
    result_url: str


TerminalHook = Callable[[AsyncSession, Any], None]
SubmitHook = Callable[[GenerationTaskContext], Awaitable[str | ImmediateGenerationResult]]
PollHook = Callable[[GenerationTaskContext], Awaitable[ProviderTaskStatus]]
MaterializeHook = Callable[[str, str], Awaitable[None]]
ErrorMapper = Callable[[Exception], str]


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
    ) -> None:
        self.session_factory = session_factory
        self.task_type = task_type
        self.active_statuses = frozenset(active_statuses)
        self.task_subject = task_subject
        self.terminal_hook = terminal_hook

    async def load(self, session: AsyncSession, task_id: str) -> Any | None:
        task = await session.get(self.task_type, task_id)
        if task is not None:
            bind_workspace(
                session,
                require_workspace_id(task.workspace_id, subject=self.task_subject),
            )
        return task

    async def recover_submitting(self) -> None:
        async with self.session_factory() as session:
            rows = list(
                (
                    await session.execute(
                        select(self.task_type).where(self.task_type.status == "submitting")
                    )
                )
                .scalars()
                .all()
            )
            for row in rows:
                require_workspace_id(row.workspace_id, subject=self.task_subject)
                row.status = "failed"
                row.error_message = SUBMISSION_INTERRUPTED_MESSAGE
                row.revision += 1
                row.updated_at = utc_now()
                self._on_terminal(session, row)
            await session.commit()

    async def active_task_ids(self, *, limit: int = 40) -> list[str]:
        async with self.session_factory() as session:
            return list(
                (
                    await session.execute(
                        select(self.task_type.id)
                        .where(self.task_type.status.in_(self.active_statuses))
                        .order_by(self.task_type.updated_at)
                        .limit(limit)
                    )
                )
                .scalars()
                .all()
            )

    async def claim(self, task_id: str) -> GenerationTaskContext | None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status not in self.active_statuses:
                return None
            workspace_id = require_workspace_id(task.workspace_id, subject=self.task_subject)
            status = task.status
            result_url = task.result_url or ""
            if status == "submitting" or (status == "processing" and result_url):
                context = self._context(task, workspace_id=workspace_id)
                await session.rollback()
                return context

            provider = (
                await session.get(ModelProvider, task.provider_id) if task.provider_id else None
            )
            if (
                provider is None
                or not provider.enabled
                or (provider.kind != "zealman_video" and not provider.api_key_ciphertext)
            ):
                await session.rollback()
                raise ValueError("供应商已停用、删除或缺少 API Key")
            context = self._context(
                task,
                workspace_id=workspace_id,
                base_url=provider.base_url,
                api_key=decrypt_secret(provider.api_key_ciphertext)
                if provider.api_key_ciphertext
                else "",
            )
            if status == "queued":
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
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def mark_progress(self, task_id: str, status: str, progress: int) -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status not in self.active_statuses:
                return
            task.status = "processing" if status == "processing" else "pending"
            task.progress = progress
            task.revision += 1
            task.updated_at = utc_now()
            await session.commit()

    async def fail(self, task_id: str, message: str, *, result_url: str = "") -> None:
        async with self.session_factory() as session:
            task = await self.load(session, task_id)
            if task is None or task.status in {"completed", "failed"}:
                return
            task.status = "failed"
            task.error_message = message[:4000]
            if result_url:
                task.result_url = result_url
            task.revision += 1
            task.updated_at = utc_now()
            self._on_terminal(session, task)
            await session.commit()

    def _context(
        self,
        task: Any,
        *,
        workspace_id: str,
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
            workspace_id=workspace_id,
        )

    def _on_terminal(self, session: AsyncSession, task: Any) -> None:
        if self.terminal_hook is not None:
            self.terminal_hook(session, task)


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

    async def recover(self) -> None:
        await self.store.recover_submitting()

    async def process(self, task_id: str) -> None:
        try:
            task = await self.store.claim(task_id)
            if task is None or task.status == "submitting":
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

            provider_status = await self.poll(task)
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
            )
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            await self.store.fail(task_id, self.map_error(exc))
