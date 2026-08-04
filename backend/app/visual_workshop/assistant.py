from __future__ import annotations

import asyncio
import base64
import json
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.concurrency.revisions import RevisionConflictError
from app.core.config import Settings, get_settings
from app.core.time import iso_utc, utc_now
from app.llm.providers import ChatMessageInput, ImageInput
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualProjectAssetReference,
    VisualWorkshopProject,
)
from app.schemas.visual_workshop import (
    VisualAssistantAssetOut,
    VisualAssistantActionOut,
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantConversationSummaryOut,
    VisualAssistantMessageOut,
    VisualAssistantModelOptionListOut,
    VisualAssistantModelOptionOut,
)

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_IMAGES = 5
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
CANVAS_CONTEXT_LIMIT = 32_000
TEXT_NODE_LIMIT = 4_000


class AssistantNotFoundError(Exception):
    pass


class AssistantBusyError(Exception):
    pass


class AssistantModelUnavailableError(Exception):
    pass


class AssistantAssetError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_asset", status: int = 422) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class PreparedAssistantGeneration:
    conversation_id: str
    assistant_message_id: str
    turn_id: str
    revision: int
    provider_kind: str
    base_url: str
    api_key_ciphertext: str
    model_slug: str
    model_changed_from: str | None
    tools_enabled: bool
    canvas_revision: int
    system_prompt: str
    messages: list[ChatMessageInput]
    request_payload: dict


def asset_out(row: VisualAsset) -> VisualAssistantAssetOut:
    return VisualAssistantAssetOut(
        id=row.id,
        display_name=row.display_name,
        mime_type=row.mime_type,
        byte_size=row.byte_size,
    )


def message_out(
    row: VisualAssistantMessage,
    assets: list[VisualAsset] | None = None,
    actions: list[VisualAssistantActionOut] | None = None,
) -> VisualAssistantMessageOut:
    return VisualAssistantMessageOut(
        id=row.id,
        turn_id=row.turn_id,
        role=row.role,
        content=row.content,
        model_slug=row.model_slug,
        status=row.status,
        error_message=row.error_message,
        created_at=iso_utc(row.created_at),
        assets=[asset_out(item) for item in assets or []],
        actions=actions or [],
    )


class VisualAssistantConversations:
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()

    async def _project(self, project_id: str) -> VisualWorkshopProject:
        row = await self.session.get(VisualWorkshopProject, project_id)
        if row is None:
            raise AssistantNotFoundError("项目不存在")
        return row

    async def _row(self, project_id: str, conversation_id: str) -> VisualAssistantConversation:
        row = await self.session.get(VisualAssistantConversation, conversation_id)
        if row is None or row.project_id != project_id:
            raise AssistantNotFoundError("对话不存在")
        return row

    async def _model_slug(self, model_id: str | None) -> str:
        if not model_id:
            return ""
        model = await self.session.get(ModelEntry, model_id)
        return model.slug if model else ""

    async def _summary(
        self, row: VisualAssistantConversation
    ) -> VisualAssistantConversationSummaryOut:
        return VisualAssistantConversationSummaryOut(
            id=row.id,
            project_id=row.project_id,
            title=row.title,
            model_id=row.model_id,
            model_slug=await self._model_slug(row.model_id),
            revision=row.revision,
            created_at=iso_utc(row.created_at),
            updated_at=iso_utc(row.updated_at),
        )

    async def list(self, project_id: str) -> VisualAssistantConversationListOut:
        await self._project(project_id)
        rows = list(
            (
                await self.session.execute(
                    select(VisualAssistantConversation)
                    .where(VisualAssistantConversation.project_id == project_id)
                    .order_by(
                        VisualAssistantConversation.updated_at.desc(),
                        VisualAssistantConversation.created_at.desc(),
                    )
                )
            )
            .scalars()
            .all()
        )
        return VisualAssistantConversationListOut(items=[await self._summary(row) for row in rows])

    async def _message_assets(self, message_ids: list[str]) -> dict[str, list[VisualAsset]]:
        if not message_ids:
            return {}
        rows = (
            await self.session.execute(
                select(VisualAssistantMessageAsset, VisualAsset)
                .join(VisualAsset, VisualAsset.id == VisualAssistantMessageAsset.asset_id)
                .where(VisualAssistantMessageAsset.message_id.in_(message_ids))
                .order_by(VisualAssistantMessageAsset.position)
            )
        ).all()
        grouped: dict[str, list[VisualAsset]] = {}
        for link, asset in rows:
            grouped.setdefault(link.message_id, []).append(asset)
        return grouped

    async def get(self, project_id: str, conversation_id: str) -> VisualAssistantConversationOut:
        row = await self._row(project_id, conversation_id)
        messages = list(
            (
                await self.session.execute(
                    select(VisualAssistantMessage)
                    .where(VisualAssistantMessage.conversation_id == conversation_id)
                    .order_by(VisualAssistantMessage.position)
                )
            )
            .scalars()
            .all()
        )
        assets = await self._message_assets([message.id for message in messages])
        action_rows = list(
            (
                await self.session.execute(
                    select(VisualAssistantAction)
                    .where(VisualAssistantAction.message_id.in_([message.id for message in messages]))
                    .order_by(VisualAssistantAction.message_id, VisualAssistantAction.position)
                )
            )
            .scalars()
            .all()
        )
        from app.visual_workshop.assistant_actions import action_out

        actions: dict[str, list[VisualAssistantActionOut]] = {}
        for action in action_rows:
            actions.setdefault(action.message_id, []).append(action_out(action))
        summary = await self._summary(row)
        return VisualAssistantConversationOut(
            **summary.model_dump(),
            messages=[
                message_out(message, assets.get(message.id), actions.get(message.id))
                for message in messages
            ],
        )

    async def _available_models(
        self, *, require_vision: bool
    ) -> list[tuple[ModelEntry, ModelProvider]]:
        rows = (
            await self.session.execute(
                select(ModelEntry, ModelProvider)
                .join(ModelProvider, ModelProvider.id == ModelEntry.provider_id)
                .where(
                    ModelEntry.enabled.is_(True),
                    ModelProvider.enabled.is_(True),
                    ModelProvider.kind.in_(("openai", "anthropic")),
                )
                .order_by(ModelProvider.sort_order, ModelEntry.sort_order, ModelEntry.slug)
            )
        ).all()
        return [
            (model, provider)
            for model, provider in rows
            if "chat" in list(model.capabilities or [])
            and (not require_vision or "vision" in list(model.capabilities or []))
        ]

    async def _select_model(
        self, model_id: str | None, *, require_vision: bool
    ) -> tuple[ModelEntry, ModelProvider, str | None]:
        models = await self._available_models(require_vision=require_vision)
        if not models:
            message = (
                "没有可用的视觉对话模型，请先启用支持 chat 和 vision 的模型"
                if require_vision
                else "没有可用的文本对话模型，请先在模型服务中启用 chat 模型"
            )
            raise AssistantModelUnavailableError(message)
        for model, provider in models:
            if model.id == model_id:
                return model, provider, None
        previous = await self._model_slug(model_id)
        model, provider = models[0]
        return model, provider, previous or ("不可用模型" if model_id else None)

    async def create(self, project_id: str) -> VisualAssistantConversationOut:
        await self._project(project_id)
        models = await self._available_models(require_vision=False)
        row = VisualAssistantConversation(
            project_id=project_id,
            model_id=models[0][0].id if models else None,
        )
        self.session.add(row)
        await self.session.commit()
        return await self.get(project_id, row.id)

    async def model_options(self, project_id: str) -> VisualAssistantModelOptionListOut:
        await self._project(project_id)
        models = await self._available_models(require_vision=False)
        return VisualAssistantModelOptionListOut(
            items=[
                VisualAssistantModelOptionOut(
                    id=model.id,
                    provider_id=provider.id,
                    provider_name=provider.name,
                    slug=model.slug,
                    label=model.label or model.slug,
                    description=model.description,
                    capabilities=list(model.capabilities or []),
                )
                for model, provider in models
            ]
        )

    async def _has_pending(self, conversation_id: str) -> bool:
        count = int(
            (
                await self.session.execute(
                    select(func.count(VisualAssistantMessage.id)).where(
                        VisualAssistantMessage.conversation_id == conversation_id,
                        VisualAssistantMessage.status == "pending",
                    )
                )
            ).scalar_one()
        )
        return count > 0

    async def _raise_conflict(self, row: VisualAssistantConversation, expected: int) -> None:
        project_id, conversation_id = row.project_id, row.id
        await self.session.rollback()
        current = await self.get(project_id, conversation_id)
        raise RevisionConflictError(expected, current.revision, current.model_dump(mode="json"))

    async def _bump(self, row: VisualAssistantConversation, expected: int) -> int:
        now = utc_now()
        result = await self.session.execute(
            update(VisualAssistantConversation)
            .where(
                VisualAssistantConversation.id == row.id,
                VisualAssistantConversation.revision == expected,
            )
            .values(revision=expected + 1, updated_at=now)
        )
        if result.rowcount != 1:
            await self._raise_conflict(row, expected)
        row.revision = expected + 1
        row.updated_at = now
        return expected + 1

    async def patch(
        self,
        project_id: str,
        conversation_id: str,
        body: VisualAssistantConversationPatchIn,
    ) -> VisualAssistantConversationOut:
        row = await self._row(project_id, conversation_id)
        if await self._has_pending(conversation_id):
            raise AssistantBusyError("生成期间不能修改对话")
        selected_model_id = row.model_id
        if "model_id" in body.model_fields_set:
            selected_model_id = body.model_id
            if selected_model_id is not None:
                models = await self._available_models(require_vision=False)
                if not any(model.id == selected_model_id for model, _provider in models):
                    raise AssistantModelUnavailableError("所选对话模型已停用或不可用")
        await self._bump(row, body.expected_revision)
        if body.title is not None:
            row.title = body.title
        if "model_id" in body.model_fields_set:
            row.model_id = selected_model_id
        await self.session.commit()
        return await self.get(project_id, conversation_id)

    async def delete(self, project_id: str, conversation_id: str, expected_revision: int) -> None:
        row = await self._row(project_id, conversation_id)
        if await self._has_pending(conversation_id):
            raise AssistantBusyError("生成期间不能删除对话")
        await self._bump(row, expected_revision)
        await self.session.execute(
            delete(VisualAssistantConversation).where(
                VisualAssistantConversation.id == conversation_id
            )
        )
        await self.session.commit()

    async def _completed_context(self, conversation_id: str) -> tuple[list[ChatMessageInput], bool]:
        rows = list(
            (
                await self.session.execute(
                    select(VisualAssistantMessage)
                    .where(VisualAssistantMessage.conversation_id == conversation_id)
                    .order_by(VisualAssistantMessage.position)
                )
            )
            .scalars()
            .all()
        )
        by_turn: dict[str, list[VisualAssistantMessage]] = {}
        for row in rows:
            by_turn.setdefault(row.turn_id, []).append(row)
        complete_turns = {
            turn_id
            for turn_id, messages in by_turn.items()
            if any(item.role == "user" and item.status == "completed" for item in messages)
            and any(item.role == "assistant" and item.status == "completed" for item in messages)
        }
        completed = [
            row for row in rows if row.turn_id in complete_turns and row.status == "completed"
        ]
        assets = await self._message_assets([row.id for row in completed])
        inputs: list[ChatMessageInput] = []
        has_images = False
        for row in completed:
            message_assets = assets.get(row.id, [])
            images = await self._images(message_assets)
            has_images = has_images or bool(images)
            inputs.append(ChatMessageInput(role=row.role, text=row.content, images=images))
        return inputs, has_images

    async def _project_assets(self, project_id: str, asset_ids: list[str]) -> list[VisualAsset]:
        if not asset_ids:
            return []
        if len(asset_ids) > MAX_IMAGES:
            raise AssistantAssetError("每条消息最多添加 5 张图片")
        rows = list(
            (await self.session.execute(select(VisualAsset).where(VisualAsset.id.in_(asset_ids))))
            .scalars()
            .all()
        )
        by_id = {row.id: row for row in rows}
        references = set(
            (
                await self.session.execute(
                    select(VisualProjectAssetReference.asset_id).where(
                        VisualProjectAssetReference.project_id == project_id,
                        VisualProjectAssetReference.asset_id.in_(asset_ids),
                    )
                )
            ).scalars()
        )
        result: list[VisualAsset] = []
        for asset_id in asset_ids:
            asset = by_id.get(asset_id)
            if asset is None or not (
                asset.project_id == project_id
                or (asset.project_id is None and asset.id in references)
            ):
                raise AssistantAssetError("图片不存在或不属于当前项目", code="scope_mismatch")
            if asset.media_kind != "image" or asset.mime_type not in ALLOWED_IMAGE_TYPES:
                raise AssistantAssetError("只支持 JPEG、PNG、WebP 和 GIF 图片")
            if asset.byte_size > MAX_IMAGE_BYTES:
                raise AssistantAssetError("图片不能超过 8MB", code="file_too_large", status=413)
            result.append(asset)
        return result

    async def _images(self, assets: list[VisualAsset]) -> tuple[ImageInput, ...]:
        async def encode(asset: VisualAsset) -> ImageInput:
            path = self.settings.visual_asset_path / asset.storage_key
            if not path.is_file():
                raise AssistantAssetError(
                    f"图片内容不存在：{asset.display_name}",
                    code="file_missing",
                    status=409,
                )
            content = await asyncio.to_thread(path.read_bytes)
            return ImageInput(
                mime_type=asset.mime_type,
                data_base64=base64.b64encode(content).decode("ascii"),
                byte_size=asset.byte_size,
            )

        return tuple(await asyncio.gather(*(encode(asset) for asset in assets)))

    async def _canvas_context(self, project: VisualWorkshopProject) -> tuple[str, dict[str, int]]:
        canvas = await self.session.get(VisualCanvasDocument, project.id)
        nodes = list(canvas.nodes or []) if canvas else []
        asset_ids = list(
            dict.fromkeys(
                str(node.get("asset_id"))
                for node in nodes
                if isinstance(node, dict) and node.get("asset_id")
            )
        )
        assets: dict[str, VisualAsset] = {}
        if asset_ids:
            assets = {
                row.id: row
                for row in (
                    (
                        await self.session.execute(
                            select(VisualAsset).where(VisualAsset.id.in_(asset_ids))
                        )
                    )
                    .scalars()
                    .all()
                )
            }
        serialized: list[str] = []
        used = 0
        omitted = 0
        for node in nodes:
            if not isinstance(node, dict):
                continue
            compact: dict[str, object] = {
                "id": node.get("id"),
                "kind": node.get("kind"),
                "title": node.get("title"),
                "position": node.get("position"),
            }
            if node.get("kind") == "text":
                text = str(node.get("text") or "")
                compact["text"] = text[:TEXT_NODE_LIMIT]
                if len(text) > TEXT_NODE_LIMIT:
                    compact["text_truncated"] = True
            asset_id = str(node.get("asset_id") or "")
            if asset_id:
                asset = assets.get(asset_id)
                compact["asset"] = {
                    "id": asset_id,
                    "name": asset.display_name if asset else "素材不可用",
                    "media_kind": asset.media_kind if asset else node.get("kind"),
                    "mime_type": asset.mime_type if asset else None,
                    "byte_size": asset.byte_size if asset else None,
                }
            if node.get("generation_task_id"):
                compact["generation_task_id"] = node.get("generation_task_id")
            item = json.dumps(compact, ensure_ascii=False, separators=(",", ":"))
            if used + len(item) > CANVAS_CONTEXT_LIMIT:
                omitted += 1
                continue
            serialized.append(item)
            used += len(item)
        suffix = f"\n另有 {omitted} 个节点因上下文长度限制未列出。" if omitted else ""
        snapshot = "[" + ",".join(serialized) + "]" + suffix
        system = (
            "你是 Future Props Lab 视觉工坊中的项目对话助手。"
            "你可以理解画布和素材、提出创作建议、检查方案并给出清晰步骤。"
            "你不能直接修改画布，也不能声称已经创建、删除或更新了节点；"
            "当用户要求修改时，请明确提供可执行建议。\n"
            f"当前项目：{project.title}\n当前画布节点：{snapshot}"
        )
        return system, {
            "node_count": len(nodes),
            "included_nodes": len(serialized),
            "omitted": omitted,
        }

    async def _position(self, conversation_id: str) -> int:
        current = (
            await self.session.execute(
                select(func.max(VisualAssistantMessage.position)).where(
                    VisualAssistantMessage.conversation_id == conversation_id
                )
            )
        ).scalar_one()
        return int(current if current is not None else -1) + 1

    async def prepare_send(
        self,
        project_id: str,
        conversation_id: str,
        expected_revision: int,
        canvas_revision: int,
        content: str,
        asset_ids: list[str],
    ) -> PreparedAssistantGeneration:
        project = await self._project(project_id)
        row = await self._row(project_id, conversation_id)
        canvas = await self.session.get(VisualCanvasDocument, project_id)
        if canvas is None or canvas.revision != canvas_revision:
            current = await self.get(project_id, conversation_id)
            raise RevisionConflictError(
                canvas_revision,
                canvas.revision if canvas is not None else 0,
                current.model_dump(mode="json"),
            )
        if await self._has_pending(conversation_id):
            raise AssistantBusyError("当前对话正在生成，请稍候")
        previous_context, context_has_images = await self._completed_context(conversation_id)
        assets = await self._project_assets(project_id, asset_ids)
        images = await self._images(assets)
        model, provider, changed_from = await self._select_model(
            row.model_id, require_vision=context_has_images or bool(images)
        )
        tools_enabled = "tools" in list(model.capabilities or [])
        revision = await self._bump(row, expected_revision)
        if row.model_id != model.id:
            row.model_id = model.id
        position = await self._position(conversation_id)
        turn_id = str(uuid4())
        user = VisualAssistantMessage(
            conversation_id=conversation_id,
            position=position,
            turn_id=turn_id,
            role="user",
            content=content.strip(),
            status="completed",
        )
        assistant = VisualAssistantMessage(
            conversation_id=conversation_id,
            position=position + 1,
            turn_id=turn_id,
            role="assistant",
            model_slug=model.slug,
            status="pending",
        )
        self.session.add_all([user, assistant])
        await self.session.flush()
        self.session.add_all(
            VisualAssistantMessageAsset(message_id=user.id, asset_id=asset.id, position=index)
            for index, asset in enumerate(assets)
        )
        if position == 0 and row.title == "AI 助手对话":
            compact_title = " ".join(content.split())
            if compact_title:
                row.title = compact_title[:24] + ("…" if len(compact_title) > 24 else "")
            elif assets:
                row.title = assets[0].display_name[:120]
        system_prompt, canvas_summary = await self._canvas_context(project)
        request_messages = [
            *previous_context,
            ChatMessageInput(role="user", text=user.content, images=images),
        ]
        log_messages = [
            {
                "role": message.role,
                "content": message.text,
                "attachments": [
                    {
                        "mime_type": image.mime_type,
                        "byte_size": image.byte_size,
                    }
                    for image in message.images
                ],
            }
            for message in request_messages
        ]
        await self.session.commit()
        return PreparedAssistantGeneration(
            conversation_id=conversation_id,
            assistant_message_id=assistant.id,
            turn_id=turn_id,
            revision=revision,
            provider_kind=provider.kind,
            base_url=provider.base_url,
            api_key_ciphertext=provider.api_key_ciphertext,
            model_slug=model.slug,
            model_changed_from=changed_from,
            tools_enabled=tools_enabled,
            canvas_revision=canvas_revision,
            system_prompt=system_prompt,
            messages=request_messages,
            request_payload={
                "system": system_prompt,
                "messages": log_messages,
                "project_id": project_id,
                "conversation_id": conversation_id,
                "message_count": len(request_messages),
                "asset_ids": asset_ids,
                "canvas": canvas_summary,
            },
        )
