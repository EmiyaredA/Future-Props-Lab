from __future__ import annotations

from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.time import iso_utc, utc_now
from app.llm.catalog.service import ResourceNotFoundError
from app.models import ModelEntry, ModelProvider, ModelTestConversation, ModelTestMessage
from app.schemas.model_test import (
    ModelTestConversationCreateIn,
    ModelTestConversationListOut,
    ModelTestConversationOut,
    ModelTestConversationPatchIn,
    ModelTestConversationSummaryOut,
    ModelTestMessageOut,
)


class ModelUnavailableError(Exception):
    pass


class ConversationBusyError(Exception):
    pass


class RegenerateUnavailableError(Exception):
    pass


@dataclass(frozen=True)
class PreparedGeneration:
    conversation_id: str
    assistant_message_id: str
    turn_id: str
    revision: int
    provider_kind: str
    base_url: str
    api_key_ciphertext: str
    model_slug: str
    system_prompt: str
    temperature: float
    max_tokens: int
    messages: list[dict[str, str]]
    request_payload: dict
    replaced_message_id: str | None = None


def message_out(row: ModelTestMessage) -> ModelTestMessageOut:
    return ModelTestMessageOut(
        id=row.id,
        turn_id=row.turn_id,
        role=row.role,
        content=row.content,
        model_slug=row.model_slug,
        status=row.status,
        error_message=row.error_message,
        created_at=iso_utc(row.created_at),
    )


class ModelTestService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _model_slug(self, model_id: str | None) -> str:
        if not model_id:
            return ""
        model = await self.session.get(ModelEntry, model_id)
        return model.slug if model else ""

    async def _summary(self, row: ModelTestConversation) -> ModelTestConversationSummaryOut:
        return ModelTestConversationSummaryOut(
            id=row.id,
            title=row.title,
            model_id=row.model_id,
            model_slug=await self._model_slug(row.model_id),
            revision=row.revision,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def list(self) -> ModelTestConversationListOut:
        rows = (
            (
                await self.session.execute(
                    select(ModelTestConversation).order_by(
                        ModelTestConversation.updated_at.desc(),
                        ModelTestConversation.created_at.desc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        return ModelTestConversationListOut(items=[await self._summary(row) for row in rows])

    async def _row(self, conversation_id: str) -> ModelTestConversation:
        row = await self.session.get(ModelTestConversation, conversation_id)
        if row is None:
            raise ResourceNotFoundError("对话不存在")
        return row

    async def get(self, conversation_id: str) -> ModelTestConversationOut:
        row = await self._row(conversation_id)
        messages = (
            (
                await self.session.execute(
                    select(ModelTestMessage)
                    .where(ModelTestMessage.conversation_id == conversation_id)
                    .order_by(ModelTestMessage.position)
                )
            )
            .scalars()
            .all()
        )
        summary = await self._summary(row)
        return ModelTestConversationOut(
            **summary.model_dump(),
            system_prompt=row.system_prompt,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
            messages=[message_out(message) for message in messages],
        )

    async def create(self, body: ModelTestConversationCreateIn) -> ModelTestConversationOut:
        if body.model_id:
            await self._available_model(body.model_id)
        row = ModelTestConversation(model_id=body.model_id)
        self.session.add(row)
        await self.session.commit()
        return await self.get(row.id)

    async def _has_pending(self, conversation_id: str) -> bool:
        count = int(
            (
                await self.session.execute(
                    select(func.count(ModelTestMessage.id)).where(
                        ModelTestMessage.conversation_id == conversation_id,
                        ModelTestMessage.status == "pending",
                    )
                )
            ).scalar_one()
        )
        return count > 0

    async def _raise_conflict(self, row: ModelTestConversation, expected: int) -> None:
        conversation_id = row.id
        await self.session.rollback()
        current = await self.get(conversation_id)
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def _bump(self, row: ModelTestConversation, expected: int) -> int:
        now = utc_now()
        result = await self.session.execute(
            update(ModelTestConversation)
            .where(
                ModelTestConversation.id == row.id,
                ModelTestConversation.revision == expected,
            )
            .values(revision=ModelTestConversation.revision + 1, updated_at=now)
        )
        if result.rowcount != 1:
            await self._raise_conflict(row, expected)
        row.revision = expected + 1
        row.updated_at = now
        return expected + 1

    async def patch(
        self, conversation_id: str, body: ModelTestConversationPatchIn
    ) -> ModelTestConversationOut:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("生成期间不能修改对话设置")
        if body.model_id is not None:
            await self._available_model(body.model_id)
        await self._bump(row, body.expected_revision)
        if body.title is not None:
            row.title = body.title.strip()
        if body.model_id is not None:
            row.model_id = body.model_id
        if body.system_prompt is not None:
            row.system_prompt = body.system_prompt
        if body.temperature is not None:
            row.temperature = body.temperature
        if body.max_tokens is not None:
            row.max_tokens = body.max_tokens
        await self.session.commit()
        return await self.get(row.id)

    async def delete(self, conversation_id: str, expected_revision: int) -> None:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("生成期间不能删除对话")
        await self._bump(row, expected_revision)
        await self.session.execute(
            delete(ModelTestConversation).where(ModelTestConversation.id == conversation_id)
        )
        await self.session.commit()

    async def _available_model(self, model_id: str | None) -> tuple[ModelEntry, ModelProvider]:
        if not model_id:
            raise ModelUnavailableError("请先选择可用的文本模型")
        model = await self.session.get(ModelEntry, model_id)
        if model is None:
            raise ModelUnavailableError("当前模型已被删除，请重新选择")
        provider = await self.session.get(ModelProvider, model.provider_id)
        if (
            provider is None
            or not provider.enabled
            or not model.enabled
            or "chat" not in list(model.capabilities or [])
        ):
            raise ModelUnavailableError("当前模型不可用，请重新选择已启用的 chat 模型")
        return model, provider

    async def _position(self, conversation_id: str) -> int:
        current = (
            await self.session.execute(
                select(func.max(ModelTestMessage.position)).where(
                    ModelTestMessage.conversation_id == conversation_id
                )
            )
        ).scalar_one()
        return int(current if current is not None else -1) + 1

    async def _completed_context(
        self, conversation_id: str, *, excluding_turn: str | None = None
    ) -> list[dict[str, str]]:
        rows = (
            (
                await self.session.execute(
                    select(ModelTestMessage)
                    .where(ModelTestMessage.conversation_id == conversation_id)
                    .order_by(ModelTestMessage.position)
                )
            )
            .scalars()
            .all()
        )
        by_turn: dict[str, list[ModelTestMessage]] = {}
        for message in rows:
            by_turn.setdefault(message.turn_id, []).append(message)
        complete_turns = {
            turn_id
            for turn_id, messages in by_turn.items()
            if turn_id != excluding_turn
            and any(m.role == "user" and m.status == "completed" for m in messages)
            and any(m.role == "assistant" and m.status == "completed" for m in messages)
        }
        return [
            {"role": row.role, "content": row.content}
            for row in rows
            if row.turn_id in complete_turns and row.status == "completed"
        ]

    async def prepare_send(
        self, conversation_id: str, expected_revision: int, content: str
    ) -> PreparedGeneration:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("当前对话正在生成，请稍候")
        model, provider = await self._available_model(row.model_id)
        context = await self._completed_context(conversation_id)
        revision = await self._bump(row, expected_revision)
        position = await self._position(conversation_id)
        turn_id = str(uuid4())
        user = ModelTestMessage(
            conversation_id=conversation_id,
            position=position,
            turn_id=turn_id,
            role="user",
            content=content.strip(),
            status="completed",
        )
        assistant = ModelTestMessage(
            conversation_id=conversation_id,
            position=position + 1,
            turn_id=turn_id,
            role="assistant",
            model_slug=model.slug,
            status="pending",
        )
        self.session.add_all([user, assistant])
        if position == 0 and row.title == "新对话":
            compact = " ".join(content.strip().split())
            row.title = compact[:28] + ("…" if len(compact) > 28 else "")
        request_messages = [*context, {"role": "user", "content": user.content}]
        await self.session.commit()
        return PreparedGeneration(
            conversation_id=conversation_id,
            assistant_message_id=assistant.id,
            turn_id=turn_id,
            revision=revision,
            provider_kind=provider.kind,
            base_url=provider.base_url,
            api_key_ciphertext=provider.api_key_ciphertext,
            model_slug=model.slug,
            system_prompt=row.system_prompt,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
            messages=request_messages,
            request_payload={
                "system": row.system_prompt,
                "messages": request_messages,
                "temperature": row.temperature,
                "max_tokens": row.max_tokens,
            },
        )

    async def prepare_regenerate(
        self, conversation_id: str, expected_revision: int
    ) -> PreparedGeneration:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("当前对话正在生成，请稍候")
        model, provider = await self._available_model(row.model_id)
        old = (
            (
                await self.session.execute(
                    select(ModelTestMessage)
                    .where(
                        ModelTestMessage.conversation_id == conversation_id,
                        ModelTestMessage.role == "assistant",
                        ModelTestMessage.status.in_(["completed", "error", "cancelled"]),
                    )
                    .order_by(ModelTestMessage.position.desc())
                    .limit(1)
                )
            )
            .scalars()
            .first()
        )
        if old is None:
            raise RegenerateUnavailableError("当前没有可重新生成的回复")
        user = (
            (
                await self.session.execute(
                    select(ModelTestMessage).where(
                        ModelTestMessage.conversation_id == conversation_id,
                        ModelTestMessage.turn_id == old.turn_id,
                        ModelTestMessage.role == "user",
                    )
                )
            )
            .scalars()
            .first()
        )
        if user is None:
            raise RegenerateUnavailableError("找不到对应的用户消息")
        context = await self._completed_context(conversation_id, excluding_turn=old.turn_id)
        revision = await self._bump(row, expected_revision)
        old.status = "superseded"
        assistant = ModelTestMessage(
            conversation_id=conversation_id,
            position=await self._position(conversation_id),
            turn_id=old.turn_id,
            role="assistant",
            model_slug=model.slug,
            status="pending",
        )
        self.session.add(assistant)
        request_messages = [*context, {"role": "user", "content": user.content}]
        await self.session.commit()
        return PreparedGeneration(
            conversation_id=conversation_id,
            assistant_message_id=assistant.id,
            turn_id=old.turn_id,
            revision=revision,
            provider_kind=provider.kind,
            base_url=provider.base_url,
            api_key_ciphertext=provider.api_key_ciphertext,
            model_slug=model.slug,
            system_prompt=row.system_prompt,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
            messages=request_messages,
            request_payload={
                "system": row.system_prompt,
                "messages": request_messages,
                "temperature": row.temperature,
                "max_tokens": row.max_tokens,
                "regenerate": True,
            },
            replaced_message_id=old.id,
        )
