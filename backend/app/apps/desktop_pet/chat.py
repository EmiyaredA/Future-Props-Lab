"""Workspace and user scoped desktop pet text conversations."""

from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.apps.desktop_pet.chat_schemas import (
    PetChatClearIn,
    PetChatMessageOut,
    PetChatMessagesOut,
    PetChatOut,
    PetChatSendIn,
    PetChatSettingsIn,
    PetChatStreamEvent,
)
from app.apps.desktop_pet.models import DesktopPetChat, DesktopPetChatMessage, DesktopPetChatRequest
from app.apps.desktop_pet.projects import DesktopPetProjects
from app.apps.desktop_pet.schemas import PetConfig
from app.llm.call_logs.credentials import CredentialSnapshot
from app.llm.providers.streaming import ChatMessageInput
from app.llm.text_client import (
    TextModel,
    add_product_text_log,
    resolve_text_model,
    stream_product_text,
)
from app.orm import bind_workspace
from app.runtime.db import SessionLocal
from app.runtime.ids import new_id
from app.runtime.operation_receipts import OperationError
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now


@dataclass(frozen=True)
class PreparedPetReply:
    workspace_id: str
    chat_id: str
    assistant_id: str
    request_id: str
    revision: int
    model: TextModel
    prompt: str
    messages: list[ChatMessageInput]
    credential: CredentialSnapshot


def _message_out(row: DesktopPetChatMessage) -> PetChatMessageOut:
    return PetChatMessageOut(
        id=row.id,
        position=row.position,
        role=row.role,
        content=row.content,
        status=row.status,
        createdAt=iso_utc(row.created_at),
    )


def _prompt(title: str, config: PetConfig) -> str:
    persona = config.persona
    return "\n".join(
        (
            f"你是桌面角色「{title}」。用自然、简洁的中文和用户聊天。",
            "你只能进行文字对话；不能声称看到了屏幕、听到了麦克风或操作了电脑。",
            f"角色简介：{persona.description}",
            f"性格：{persona.personality}",
            f"说话方式：{persona.speaking_style}",
            f"开场白：{persona.greeting}",
        )
    )


class DesktopPetChats:
    def __init__(self, session: AsyncSession, workspace_id: str, user_id: str) -> None:
        self.session = session
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.projects = DesktopPetProjects(session, workspace_id)

    async def _chat(self, project_id: str) -> DesktopPetChat | None:
        await self.projects.row(project_id)
        return await self.session.scalar(
            select(DesktopPetChat).where(
                DesktopPetChat.workspace_id == self.workspace_id,
                DesktopPetChat.project_id == project_id,
                DesktopPetChat.user_id == self.user_id,
            )
        )

    async def _recover(self, row: DesktopPetChat | None) -> None:
        if not row or not row.active_request_id:
            return
        if utc_now() - row.updated_at < timedelta(seconds=150):
            return
        await self.session.execute(
            update(DesktopPetChatMessage)
            .where(
                DesktopPetChatMessage.chat_id == row.id,
                DesktopPetChatMessage.status == "pending",
            )
            .values(status="interrupted", updated_at=utc_now())
        )
        row.active_request_id = None
        row.revision += 1
        row.updated_at = utc_now()
        await self.session.commit()

    async def _page(self, chat_id: str, before: int | None, limit: int) -> PetChatMessagesOut:
        query = select(DesktopPetChatMessage).where(DesktopPetChatMessage.chat_id == chat_id)
        if before is not None:
            query = query.where(DesktopPetChatMessage.position < before)
        rows = list(
            (
                await self.session.scalars(
                    query.order_by(DesktopPetChatMessage.position.desc()).limit(limit + 1)
                )
            ).all()
        )
        more = len(rows) > limit
        rows = rows[:limit]
        return PetChatMessagesOut(
            items=[_message_out(row) for row in reversed(rows)],
            nextBefore=rows[-1].position if more and rows else None,
        )

    async def get(self, project_id: str) -> PetChatOut:
        row = await self._chat(project_id)
        await self._recover(row)
        project = await self.projects.row(project_id)
        page = (
            await self._page(row.id, None, 50)
            if row
            else PetChatMessagesOut(items=[], nextBefore=None)
        )
        return PetChatOut(
            revision=row.revision if row else 0,
            modelId=row.model_id if row else None,
            proactiveLinesEnabled=(
                row.proactive_lines_enabled
                if row
                else (project.whale_model or {}).get("rigProfile") != "human-chibi"
            ),
            active=bool(row and row.active_request_id),
            presentation_mode=row.presentation_mode if row else "bubble",
            messages=page.items,
            nextBefore=page.next_before,
        )

    async def messages(self, project_id: str, before: int | None, limit: int) -> PetChatMessagesOut:
        row = await self._chat(project_id)
        return (
            await self._page(row.id, before, limit)
            if row
            else PetChatMessagesOut(items=[], nextBefore=None)
        )

    async def _conflict(self, project_id: str, expected: int) -> None:
        current = await self.get(project_id)
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def settings(self, project_id: str, body: PetChatSettingsIn) -> PetChatOut:
        row = await self._chat(project_id)
        if body.model_id:
            await resolve_text_model(self.session, self.workspace_id, body.model_id)
        if row is None:
            if body.expected_revision != 0:
                await self._conflict(project_id, body.expected_revision)
            await self.session.rollback()
            result = await self.session.execute(
                sqlite_insert(DesktopPetChat)
                .values(
                    workspace_id=self.workspace_id,
                    project_id=project_id,
                    user_id=self.user_id,
                    model_id=body.model_id,
                    proactive_lines_enabled=body.proactive_lines_enabled,
                    presentation_mode=body.presentation_mode or "bubble",
                    revision=1,
                )
                .on_conflict_do_nothing(
                    index_elements=[
                        "workspace_id",
                        "project_id",
                        "user_id",
                    ]
                )
            )
            if result.rowcount != 1:
                await self.session.rollback()
                await self._conflict(project_id, body.expected_revision)
            await self.session.commit()
            return await self.get(project_id)
        result = await self.session.execute(
            update(DesktopPetChat)
            .where(
                DesktopPetChat.id == row.id,
                DesktopPetChat.revision == body.expected_revision,
                DesktopPetChat.active_request_id.is_(None),
            )
            .values(
                model_id=body.model_id,
                proactive_lines_enabled=body.proactive_lines_enabled,
                presentation_mode=body.presentation_mode or row.presentation_mode,
                revision=body.expected_revision + 1,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            await self._conflict(project_id, body.expected_revision)
        await self.session.commit()
        return await self.get(project_id)

    async def clear(self, project_id: str, body: PetChatClearIn) -> PetChatOut:
        row = await self._chat(project_id)
        if row is None or row.revision != body.expected_revision or row.active_request_id:
            await self._conflict(project_id, body.expected_revision)
        result = await self.session.execute(
            update(DesktopPetChat)
            .where(
                DesktopPetChat.id == row.id,
                DesktopPetChat.revision == body.expected_revision,
                DesktopPetChat.active_request_id.is_(None),
            )
            .values(revision=body.expected_revision + 1, updated_at=utc_now())
        )
        if result.rowcount != 1:
            await self.session.rollback()
            await self._conflict(project_id, body.expected_revision)
        await self.session.execute(
            delete(DesktopPetChatMessage).where(DesktopPetChatMessage.chat_id == row.id)
        )
        await self.session.commit()
        return await self.get(project_id)

    async def prepare_send(
        self, project_id: str, body: PetChatSendIn, credential: CredentialSnapshot
    ) -> PreparedPetReply:
        project = await self.projects.row(project_id)
        row = await self._chat(project_id)
        if row is None or not row.model_id:
            raise OperationError("先选择可用的文字模型", "model_required", 409)
        duplicate = await self.session.scalar(
            select(DesktopPetChatRequest.request_id).where(
                DesktopPetChatRequest.chat_id == row.id,
                DesktopPetChatRequest.request_id == body.request_id,
            )
        )
        if duplicate:
            raise OperationError("这条消息已经提交，请刷新聊天记录", "duplicate_request", 409)
        if row.revision != body.expected_revision or row.active_request_id:
            await self._conflict(project_id, body.expected_revision)
        model = await resolve_text_model(self.session, self.workspace_id, row.model_id)
        recent = list(
            (
                await self.session.scalars(
                    select(DesktopPetChatMessage)
                    .where(
                        DesktopPetChatMessage.chat_id == row.id,
                        DesktopPetChatMessage.status == "completed",
                    )
                    .order_by(DesktopPetChatMessage.position.desc())
                    .limit(24)
                )
            ).all()
        )
        messages = [
            ChatMessageInput(role=item.role, text=item.content) for item in reversed(recent)
        ]
        while sum(len(item.text) for item in messages) > 12000:
            messages.pop(0)
        content = body.content.strip()
        if not content:
            raise OperationError("消息不能为空", "invalid_message", 422)
        messages.append(ChatMessageInput(role="user", text=content))
        position = (
            await self.session.scalar(
                select(func.max(DesktopPetChatMessage.position)).where(
                    DesktopPetChatMessage.chat_id == row.id
                )
            )
        ) or 0
        result = await self.session.execute(
            update(DesktopPetChat)
            .where(
                DesktopPetChat.id == row.id,
                DesktopPetChat.revision == body.expected_revision,
                DesktopPetChat.active_request_id.is_(None),
            )
            .values(
                revision=body.expected_revision + 1,
                active_request_id=body.request_id,
                updated_at=utc_now(),
            )
        )
        if result.rowcount != 1:
            await self.session.rollback()
            await self._conflict(project_id, body.expected_revision)
        assistant_id = new_id()
        self.session.add_all(
            (
                DesktopPetChatRequest(chat_id=row.id, request_id=body.request_id),
                DesktopPetChatMessage(
                    chat_id=row.id,
                    position=position + 1,
                    request_id=body.request_id,
                    role="user",
                    content=content,
                    status="completed",
                ),
                DesktopPetChatMessage(
                    id=assistant_id,
                    chat_id=row.id,
                    position=position + 2,
                    request_id=None,
                    role="assistant",
                    content="",
                    status="pending",
                ),
            )
        )
        await self.session.commit()
        return PreparedPetReply(
            workspace_id=self.workspace_id,
            chat_id=row.id,
            assistant_id=assistant_id,
            request_id=body.request_id,
            revision=body.expected_revision + 1,
            model=model,
            prompt=_prompt(project.title, PetConfig.model_validate(project.config)),
            messages=messages,
            credential=credential,
        )


async def _settle(
    prepared: PreparedPetReply,
    *,
    content: str,
    success: bool,
    usage: dict[str, int],
    elapsed_ms: int,
) -> tuple[PetChatMessageOut | None, int | None]:
    async with SessionLocal() as session:
        bind_workspace(session.sync_session, prepared.workspace_id)
        row = await session.get(DesktopPetChat, prepared.chat_id)
        message = await session.get(DesktopPetChatMessage, prepared.assistant_id)
        if row is None or message is None or row.active_request_id != prepared.request_id:
            return None, None
        message.content = content if success else ""
        message.status = "completed" if success else "interrupted"
        message.updated_at = utc_now()
        row.active_request_id = None
        row.revision += 1
        row.updated_at = utc_now()
        add_product_text_log(
            session,
            workspace_id=prepared.workspace_id,
            call_source="desktop_pet_chat",
            model=prepared.model,
            trace_id=prepared.assistant_id,
            credential=prepared.credential,
            request_payload={"chat_id": prepared.chat_id, "message_count": len(prepared.messages)},
            response_payload={"status": message.status, "length": len(content)},
            usage=usage,
            latency_ms=elapsed_ms,
            success=success,
            error_message=None if success else "模型调用中断或失败",
        )
        await session.commit()
        return _message_out(message), row.revision


async def stream_reply(prepared: PreparedPetReply) -> AsyncIterator[str]:
    started = time.monotonic()
    text = ""
    usage: dict[str, int] = {}
    try:
        yield (
            "data: "
            + PetChatStreamEvent(type="start", revision=prepared.revision).model_dump_json()
            + "\n\n"
        )
        async for delta in stream_product_text(
            prepared.model, system_prompt=prepared.prompt, messages=prepared.messages
        ):
            if delta.text:
                text += delta.text
                yield (
                    "data: "
                    + PetChatStreamEvent(type="delta", text=delta.text).model_dump_json()
                    + "\n\n"
                )
            for name in ("prompt_tokens", "completion_tokens", "total_tokens"):
                value = getattr(delta, name)
                if value is not None:
                    usage[name] = value
    except BaseException as exc:
        await asyncio.shield(
            _settle(
                prepared,
                content=text,
                success=False,
                usage=usage,
                elapsed_ms=int((time.monotonic() - started) * 1000),
            )
        )
        if isinstance(exc, (asyncio.CancelledError, GeneratorExit)):
            raise
        yield (
            "data: "
            + PetChatStreamEvent(
                type="error", detail="模型回复失败，请检查模型配置与调用日志"
            ).model_dump_json()
            + "\n\n"
        )
        return
    message, revision = await _settle(
        prepared,
        content=text,
        success=True,
        usage=usage,
        elapsed_ms=int((time.monotonic() - started) * 1000),
    )
    yield (
        "data: "
        + PetChatStreamEvent(type="done", message=message, revision=revision).model_dump_json()
        + "\n\n"
    )


async def abandon_reply(prepared: PreparedPetReply) -> None:
    """Settle a reservation if the response closes before its generator starts."""
    await _settle(prepared, content="", success=False, usage={}, elapsed_ms=0)
