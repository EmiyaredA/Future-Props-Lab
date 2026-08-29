from __future__ import annotations

import asyncio
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings, get_settings
from app.core.time import iso_utc, utc_now
from app.llm.catalog.service import ResourceNotFoundError
from app.llm.playground.attachments import (
    AttachmentError,
    ModelTestAttachments,
    attachment_out,
)
from app.llm.playground.test_tools import ModelTestTools, call_out, tool_snapshot
from app.llm.providers import ChatMessageInput, ImageInput
from app.models import (
    ModelEntry,
    ModelProvider,
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestConversationToolBinding,
    ModelTestMessage,
    ModelTestTool,
    ModelTestToolCall,
)
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
    workspace_id: str
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
    messages: list[ChatMessageInput]
    request_payload: dict
    tool_snapshots: tuple[dict, ...] = ()
    replaced_message_id: str | None = None


def message_out(
    row: ModelTestMessage,
    attachments: list[ModelTestAttachment] | None = None,
    tool_calls: list[ModelTestToolCall] | None = None,
) -> ModelTestMessageOut:
    return ModelTestMessageOut(
        id=row.id,
        turn_id=row.turn_id,
        role=row.role,
        content=row.content,
        model_slug=row.model_slug,
        status=row.status,
        error_message=row.error_message,
        created_at=iso_utc(row.created_at),
        attachments=[attachment_out(item) for item in attachments or []],
        tool_calls=[call_out(item) for item in tool_calls or []],
    )


class ModelTestService:
    def __init__(
        self, session: AsyncSession, workspace_id: str, settings: Settings | None = None
    ) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.attachments = ModelTestAttachments(session, self.settings, workspace_id)

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

    async def _attachment_rows(self, conversation_id: str) -> list[ModelTestAttachment]:
        return list(
            (
                await self.session.execute(
                    select(ModelTestAttachment)
                    .where(ModelTestAttachment.conversation_id == conversation_id)
                    .order_by(ModelTestAttachment.position, ModelTestAttachment.created_at)
                )
            )
            .scalars()
            .all()
        )

    @staticmethod
    def _attachments_by_message(
        rows: list[ModelTestAttachment],
    ) -> tuple[dict[str, list[ModelTestAttachment]], list[ModelTestAttachment]]:
        by_message: dict[str, list[ModelTestAttachment]] = {}
        drafts: list[ModelTestAttachment] = []
        for attachment in rows:
            if attachment.message_id is None:
                drafts.append(attachment)
            else:
                by_message.setdefault(attachment.message_id, []).append(attachment)
        return by_message, drafts

    async def get(self, conversation_id: str) -> ModelTestConversationOut:
        row = await self._row(conversation_id)
        messages = list(
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
        by_message, drafts = self._attachments_by_message(
            await self._attachment_rows(conversation_id)
        )
        tool_call_rows = list(
            (
                await self.session.execute(
                    select(ModelTestToolCall)
                    .where(ModelTestToolCall.conversation_id == conversation_id)
                    .order_by(ModelTestToolCall.created_at)
                )
            )
            .scalars()
            .all()
        )
        calls_by_message: dict[str, list[ModelTestToolCall]] = {}
        for call in tool_call_rows:
            if call.message_id:
                calls_by_message.setdefault(call.message_id, []).append(call)
        selected_tools = await self._selected_tools(conversation_id)
        summary = await self._summary(row)
        return ModelTestConversationOut(
            **summary.model_dump(),
            system_prompt=row.system_prompt,
            temperature=row.temperature,
            max_tokens=row.max_tokens,
            messages=[
                message_out(
                    message,
                    by_message.get(message.id),
                    calls_by_message.get(message.id),
                )
                for message in messages
            ],
            draft_attachments=[attachment_out(item) for item in drafts],
            tools=[await ModelTestTools(self.session).summary(item) for item in selected_tools],
        )

    async def _selected_tools(self, conversation_id: str) -> list[ModelTestTool]:
        return list(
            (
                await self.session.execute(
                    select(ModelTestTool)
                    .join(
                        ModelTestConversationToolBinding,
                        ModelTestConversationToolBinding.tool_id == ModelTestTool.id,
                    )
                    .where(ModelTestConversationToolBinding.conversation_id == conversation_id)
                    .order_by(ModelTestConversationToolBinding.position)
                )
            )
            .scalars()
            .all()
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
            await self._available_model(
                body.model_id,
                require_vision=await self._has_completed_image_context(conversation_id),
            )
        selected_tools: list[ModelTestTool] | None = None
        if body.tool_ids is not None:
            selected_tools = []
            for tool_id in body.tool_ids:
                tool = await self.session.get(ModelTestTool, tool_id)
                if tool is None or not tool.enabled:
                    raise ModelUnavailableError("只能选择当前 Workspace 已启用的测试工具")
                selected_tools.append(tool)
            target_model_id = body.model_id if body.model_id is not None else row.model_id
            if selected_tools:
                await self._available_model(target_model_id, require_tools=True)
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
        if selected_tools is not None:
            await self.session.execute(
                delete(ModelTestConversationToolBinding).where(
                    ModelTestConversationToolBinding.conversation_id == conversation_id
                )
            )
            self.session.add_all(
                ModelTestConversationToolBinding(
                    conversation_id=conversation_id, tool_id=tool.id, position=position
                )
                for position, tool in enumerate(selected_tools)
            )
        await self.session.commit()
        return await self.get(row.id)

    async def delete(self, conversation_id: str, expected_revision: int) -> None:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("生成期间不能删除对话")
        paths = await self.attachments.paths_for_conversation(conversation_id)
        await self._bump(row, expected_revision)
        await self.session.execute(
            delete(ModelTestConversation).where(ModelTestConversation.id == conversation_id)
        )
        await self.session.commit()
        for path in paths:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass

    async def _available_model(
        self,
        model_id: str | None,
        *,
        require_vision: bool = False,
        require_tools: bool = False,
    ) -> tuple[ModelEntry, ModelProvider]:
        if not model_id:
            raise ModelUnavailableError("请先选择可用的文本模型")
        model = await self.session.get(ModelEntry, model_id)
        if model is None:
            raise ModelUnavailableError("当前模型已被删除，请重新选择")
        provider = await self.session.get(ModelProvider, model.provider_id)
        capabilities = list(model.capabilities or [])
        if (
            provider is None
            or not provider.enabled
            or not model.enabled
            or provider.kind not in {"openai", "anthropic"}
        ):
            raise ModelUnavailableError("当前模型不可用，请重新选择已启用的文本模型")
        if require_vision and "vision" not in capabilities:
            raise ModelUnavailableError("当前对话包含图片，请选择支持 vision 的模型")
        if require_tools and "tools" not in capabilities:
            raise ModelUnavailableError("当前会话已选择测试工具，请选择支持 tools 的模型")
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

    async def _completed_rows(
        self, conversation_id: str, *, excluding_turn: str | None = None
    ) -> tuple[list[ModelTestMessage], dict[str, list[ModelTestAttachment]]]:
        rows = list(
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
            and any(item.role == "user" and item.status == "completed" for item in messages)
            and any(item.role == "assistant" and item.status == "completed" for item in messages)
        }
        completed = [
            item for item in rows if item.turn_id in complete_turns and item.status == "completed"
        ]
        message_ids = [item.id for item in completed]
        attachment_rows: list[ModelTestAttachment] = []
        if message_ids:
            attachment_rows = list(
                (
                    await self.session.execute(
                        select(ModelTestAttachment)
                        .where(ModelTestAttachment.message_id.in_(message_ids))
                        .order_by(ModelTestAttachment.position)
                    )
                )
                .scalars()
                .all()
            )
        by_message, _ = self._attachments_by_message(attachment_rows)
        return completed, by_message

    async def _has_completed_image_context(self, conversation_id: str) -> bool:
        rows, by_message = await self._completed_rows(conversation_id)
        return any(by_message.get(row.id) for row in rows)

    async def _images(self, rows: list[ModelTestAttachment]) -> tuple[ImageInput, ...]:
        encoded = await asyncio.gather(*(self.attachments.encoded(row) for row in rows))
        return tuple(
            ImageInput(
                mime_type=row.mime_type,
                data_base64=data,
                byte_size=row.byte_size,
            )
            for row, data in zip(rows, encoded, strict=True)
        )

    @staticmethod
    def _log_message(row: ModelTestMessage, rows: list[ModelTestAttachment]) -> dict:
        return {
            "role": row.role,
            "content": row.content,
            "attachments": [
                {"mime_type": item.mime_type, "byte_size": item.byte_size} for item in rows
            ],
        }

    async def _context(
        self, conversation_id: str, *, excluding_turn: str | None = None
    ) -> tuple[list[ChatMessageInput], list[dict], bool]:
        rows, by_message = await self._completed_rows(
            conversation_id, excluding_turn=excluding_turn
        )
        inputs: list[ChatMessageInput] = []
        logs: list[dict] = []
        has_images = False
        for row in rows:
            attachments = by_message.get(row.id, [])
            images = await self._images(attachments)
            has_images = has_images or bool(images)
            inputs.append(ChatMessageInput(role=row.role, text=row.content, images=images))
            logs.append(self._log_message(row, attachments))
        return inputs, logs, has_images

    async def _drafts(
        self, conversation_id: str, attachment_ids: list[str]
    ) -> list[ModelTestAttachment]:
        if not attachment_ids:
            return []
        rows = list(
            (
                await self.session.execute(
                    select(ModelTestAttachment).where(ModelTestAttachment.id.in_(attachment_ids))
                )
            )
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        ordered: list[ModelTestAttachment] = []
        for attachment_id in attachment_ids:
            attachment = by_id.get(attachment_id)
            if (
                attachment is None
                or attachment.conversation_id != conversation_id
                or attachment.message_id is not None
            ):
                raise AttachmentError(
                    "图片附件不存在、已发送或不属于当前对话",
                    code="attachment_not_available",
                    status=409,
                )
            ordered.append(attachment)
        return ordered

    async def _tool_snapshots_for_run(self, conversation_id: str) -> tuple[dict, ...]:
        tools = await self._selected_tools(conversation_id)
        disabled = [tool.name for tool in tools if not tool.enabled]
        if disabled:
            raise ModelUnavailableError(
                f"已选择的测试工具已停用：{', '.join(disabled)}，请移除或重新启用"
            )
        return tuple(tool_snapshot(tool) for tool in tools)

    async def prepare_send(
        self,
        conversation_id: str,
        expected_revision: int,
        content: str,
        attachment_ids: list[str] | None = None,
    ) -> PreparedGeneration:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("当前对话正在生成，请稍候")
        context, context_log, context_has_images = await self._context(conversation_id)
        drafts = await self._drafts(conversation_id, attachment_ids or [])
        tool_snapshots = await self._tool_snapshots_for_run(conversation_id)
        require_vision = context_has_images or bool(drafts)
        model, provider = await self._available_model(
            row.model_id,
            require_vision=require_vision,
            require_tools=bool(tool_snapshots),
        )
        draft_images = await self._images(drafts)
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
        await self.session.flush()
        for attachment_position, attachment in enumerate(drafts):
            attachment.message_id = user.id
            attachment.position = attachment_position
        if position == 0 and row.title == "新对话":
            compact = " ".join(content.strip().split())
            if compact:
                row.title = compact[:28] + ("…" if len(compact) > 28 else "")
            elif drafts:
                row.title = drafts[0].original_filename[:120]
        user_input = ChatMessageInput(role="user", text=user.content, images=draft_images)
        request_messages = [*context, user_input]
        user_log = self._log_message(user, drafts)
        await self.session.commit()
        return PreparedGeneration(
            workspace_id=row.workspace_id,
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
                "messages": [*context_log, user_log],
                "temperature": row.temperature,
                "max_tokens": row.max_tokens,
                "tools": list(tool_snapshots),
            },
            tool_snapshots=tool_snapshots,
        )

    async def prepare_regenerate(
        self, conversation_id: str, expected_revision: int
    ) -> PreparedGeneration:
        row = await self._row(conversation_id)
        if await self._has_pending(conversation_id):
            raise ConversationBusyError("当前对话正在生成，请稍候")
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
        context, context_log, context_has_images = await self._context(
            conversation_id, excluding_turn=old.turn_id
        )
        user_attachments = list(
            (
                await self.session.execute(
                    select(ModelTestAttachment)
                    .where(ModelTestAttachment.message_id == user.id)
                    .order_by(ModelTestAttachment.position)
                )
            )
            .scalars()
            .all()
        )
        tool_snapshots = await self._tool_snapshots_for_run(conversation_id)
        model, provider = await self._available_model(
            row.model_id,
            require_vision=context_has_images or bool(user_attachments),
            require_tools=bool(tool_snapshots),
        )
        user_images = await self._images(user_attachments)
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
        user_input = ChatMessageInput(role="user", text=user.content, images=user_images)
        request_messages = [*context, user_input]
        await self.session.commit()
        return PreparedGeneration(
            workspace_id=row.workspace_id,
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
                "messages": [*context_log, self._log_message(user, user_attachments)],
                "temperature": row.temperature,
                "max_tokens": row.max_tokens,
                "regenerate": True,
                "tools": list(tool_snapshots),
            },
            tool_snapshots=tool_snapshots,
            replaced_message_id=old.id,
        )
