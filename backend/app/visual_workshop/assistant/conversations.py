from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from pypdf import PdfReader
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.storage import AssetStorage
from app.llm.providers import ChatMessageInput
from app.models import (
    ModelEntry,
    ModelProvider,
    VisualAsset,
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualCanvasDocument,
    VisualWorkshopProject,
)
from app.runtime.config import Settings, get_settings
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import iso_utc, utc_now
from app.schemas.visual_workshop import (
    VisualAssistantActionOut,
    VisualAssistantAssetOut,
    VisualAssistantContentPart,
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationPatchIn,
    VisualAssistantConversationSummaryOut,
    VisualAssistantMessageOut,
    VisualAssistantModelOptionListOut,
    VisualAssistantModelOptionOut,
)
from app.visual_workshop.assistant.actions import action_out
from app.visual_workshop.assistant.attachments import (
    VisualAssistantAttachmentMixin,
)

MAX_DOCUMENT_CHARS = 50_000
MAX_PDF_PAGES = 50
CANVAS_CONTEXT_LIMIT = 32_000
TEXT_NODE_LIMIT = 4_000


class AssistantNotFoundError(Exception):
    pass


class AssistantBusyError(Exception):
    pass


class AssistantModelUnavailableError(Exception):
    pass


@dataclass(frozen=True)
class PreparedAssistantGeneration:
    workspace_id: str
    project_id: str
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
    image_model_id: str | None
    image_model_slug: str
    video_model_id: str | None
    video_model_slug: str
    system_prompt: str
    messages: list[ChatMessageInput]
    request_payload: dict
    attachment_warnings: tuple[str, ...] = ()
    auth_kind: str | None = None
    api_key_id: str | None = None
    api_key_name: str | None = None
    api_key_prefix: str | None = None


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
        content_parts=row.content_parts or [],
        assets=[asset_out(item) for item in assets or []],
        actions=actions or [],
    )


class VisualAssistantConversations(VisualAssistantAttachmentMixin):
    def __init__(self, session: AsyncSession, settings: Settings | None = None) -> None:
        self.session = session
        self.settings = settings or get_settings()
        self.storage = AssetStorage(self.settings)

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
            image_model_id=row.image_model_id,
            image_model_slug=await self._model_slug(row.image_model_id),
            video_model_id=row.video_model_id,
            video_model_slug=await self._model_slug(row.video_model_id),
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
                    .where(
                        VisualAssistantAction.message_id.in_([message.id for message in messages])
                    )
                    .order_by(VisualAssistantAction.message_id, VisualAssistantAction.position)
                )
            )
            .scalars()
            .all()
        )
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
        filtered = [
            (model, provider)
            for model, provider in rows
            if "chat" in list(model.capabilities or [])
            and (not require_vision or "vision" in list(model.capabilities or []))
        ]
        return sorted(
            filtered,
            key=lambda item: ("tools" not in list(item[0].capabilities or []),),
        )

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

    async def _validate_generation_model(self, model_id: str, kind: str) -> None:
        model = await self.session.get(ModelEntry, model_id)
        provider = await self.session.get(ModelProvider, model.provider_id) if model else None
        if (
            model is None
            or provider is None
            or not model.enabled
            or not provider.enabled
            or provider.kind != f"senseaudio_{kind}"
            or f"{kind}_generation" not in list(model.capabilities or [])
        ):
            label = "图像" if kind == "image" else "视频"
            raise AssistantModelUnavailableError(f"所选{label}生成模型已停用或不可用")

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
        selected_image_model_id = row.image_model_id
        selected_video_model_id = row.video_model_id
        if "model_id" in body.model_fields_set:
            selected_model_id = body.model_id
            if selected_model_id is not None:
                models = await self._available_models(require_vision=False)
                if not any(model.id == selected_model_id for model, _provider in models):
                    raise AssistantModelUnavailableError("所选对话模型已停用或不可用")
        if "image_model_id" in body.model_fields_set:
            selected_image_model_id = body.image_model_id
            if selected_image_model_id is not None:
                await self._validate_generation_model(selected_image_model_id, "image")
        if "video_model_id" in body.model_fields_set:
            selected_video_model_id = body.video_model_id
            if selected_video_model_id is not None:
                await self._validate_generation_model(selected_video_model_id, "video")
        await self._bump(row, body.expected_revision)
        if body.title is not None:
            row.title = body.title
        if "model_id" in body.model_fields_set:
            row.model_id = selected_model_id
        if "image_model_id" in body.model_fields_set:
            row.image_model_id = selected_image_model_id
        if "video_model_id" in body.model_fields_set:
            row.video_model_id = selected_video_model_id
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
            text, images, _warnings = await self._message_input(
                row.content,
                message_assets,
                row.content_parts,
            )
            has_images = has_images or bool(images)
            inputs.append(ChatMessageInput(role=row.role, text=text, images=images))
        return inputs, has_images

    @staticmethod
    def _read_pdf(path: Path) -> tuple[str, str | None]:
        try:
            reader = PdfReader(path)
            if reader.is_encrypted:
                try:
                    if reader.decrypt("") == 0:
                        return "", "PDF 已加密，无法提取正文"
                except Exception:
                    return "", "PDF 已加密，无法提取正文"
            parts: list[str] = []
            for page in reader.pages[:MAX_PDF_PAGES]:
                parts.append(page.extract_text() or "")
            text = "\n".join(parts).strip()
            if not text:
                return "", "PDF 未提取到可读正文"
            warnings: list[str] = []
            if len(reader.pages) > MAX_PDF_PAGES:
                warnings.append(f"PDF 仅读取前 {MAX_PDF_PAGES} 页")
            if len(text) > MAX_DOCUMENT_CHARS:
                text = text[:MAX_DOCUMENT_CHARS]
                warnings.append(f"PDF 正文已截断为 {MAX_DOCUMENT_CHARS} 字符")
            return text, "；".join(warnings) or None
        except Exception:
            return "", "PDF 解析失败，已仅提供文件元数据"

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
        content_parts: list[VisualAssistantContentPart],
        credential=None,
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
        stored_content_parts = self._normalize_content_parts(content_parts)
        if stored_content_parts:
            asset_ids = list(
                dict.fromkeys(
                    str(part["asset_id"])
                    for part in stored_content_parts
                    if part["type"] == "asset"
                )
            )
        assets = await self._project_assets(project_id, asset_ids)
        if stored_content_parts:
            content = self._content_projection(
                stored_content_parts,
                {asset.id: asset for asset in assets},
                for_model=False,
            )
        message_text, images, attachment_warnings = await self._message_input(
            content,
            assets,
            stored_content_parts,
        )
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
            content_parts=stored_content_parts,
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
            ChatMessageInput(role="user", text=message_text, images=images),
        ]
        await self.session.commit()
        return PreparedAssistantGeneration(
            workspace_id=project.workspace_id,
            project_id=project_id,
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
            image_model_id=row.image_model_id,
            image_model_slug=await self._model_slug(row.image_model_id),
            video_model_id=row.video_model_id,
            video_model_slug=await self._model_slug(row.video_model_id),
            system_prompt=system_prompt,
            messages=request_messages,
            request_payload={
                "project_id": project_id,
                "conversation_id": conversation_id,
                "message_count": len(request_messages),
                "asset_ids": asset_ids,
                "attachment_count": len(assets),
                "content_part_count": len(stored_content_parts),
                "generation_models": {
                    "image": row.image_model_id,
                    "video": row.video_model_id,
                },
                "canvas": canvas_summary,
            },
            attachment_warnings=attachment_warnings,
            **(credential.as_kwargs() if credential is not None else {}),
        )
