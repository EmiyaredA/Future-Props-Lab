"""Prepare an owned assistant turn without holding a writer across peer calls."""

from collections import defaultdict
from dataclasses import dataclass
from uuid import uuid4

from sqlalchemy import select, text

from app.apps.visual_workshop.assistant_input_values import (
    canvas_context,
    content_projection,
    message_input,
    normalize_content_parts,
)
from app.apps.visual_workshop.models import (
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
)
from app.capabilities.agents.harness.contracts import AgentMessage, ImageInput
from app.runtime.ids import new_id
from app.runtime.revisions import RevisionConflictError
from app.runtime.time import utc_now
from fpl_runtime.project_errors import ProjectResourceError
from fpl_runtime.visual_assistant_model import AssistantModelPlan, AssistantRunStart, RunScope

from .assistant_dispatch_records import VisualAssistantDispatch
from .assistant_model_client import AssistantModelClient
from .assistant_peers import AssistantPeers
from .conversations import Conversations
from .reference_backlog import pending_outcomes


class TurnConflict(Exception):
    def __init__(self, expected, actual):
        self.expected, self.actual = expected, actual


@dataclass(frozen=True)
class PreparedTurn:
    owner: str
    scope: RunScope
    trace_id: str
    turn_id: str
    message_id: str
    revision: int
    canvas_revision: int
    model: AssistantModelPlan
    model_changed_from: str | None
    image_model_id: str | None
    video_model_id: str | None
    image_model_slug: str
    video_model_slug: str
    system: str
    messages: list[AgentMessage]
    warnings: tuple[str, ...]
    peer: AssistantModelClient


@dataclass(frozen=True)
class FrozenConversation:
    project_title: str
    nodes: list
    row: VisualAssistantConversation
    transcript: list[VisualAssistantMessage]
    links: dict[str, list[str]]

    @property
    def next_position(self):
        return self.transcript[-1].position + 1 if self.transcript else 0

    @property
    def completed(self):
        users = {
            row.turn_id
            for row in self.transcript
            if row.role == "user" and row.status == "completed"
        }
        replies = {
            row.turn_id
            for row in self.transcript
            if row.role == "assistant" and row.status == "completed"
        }
        turns = users & replies
        return [
            row for row in self.transcript if row.turn_id in turns and row.status == "completed"
        ]


class AssistantSubmission:
    def __init__(self, request, session, owner, dispatches):
        self.db, self.owner, self.state = session, owner, request.app.state
        self.source = request.url.path
        self.peers = AssistantPeers(request, owner)
        self.conversations = Conversations(session, owner, self.peers)
        self.dispatches = dispatches

    async def read(self, project_id, conversation_id, body):
        await self.db.execute(text("BEGIN"))
        project = await self.conversations.projects.row(project_id)
        row = await self.conversations.row(project_id, conversation_id)
        canvas = await self.conversations.projects.canvas_row(project_id)
        check_versions(row, canvas, body)
        transcript = list(
            await self.db.scalars(
                select(VisualAssistantMessage)
                .where(VisualAssistantMessage.conversation_id == conversation_id)
                .order_by(VisualAssistantMessage.position)
            )
        )
        if any(message.status == "pending" for message in transcript):
            raise busy()
        links = defaultdict(list)
        identities = [message.id for message in transcript]
        if identities:
            for link in await self.db.scalars(
                select(VisualAssistantMessageAsset)
                .where(VisualAssistantMessageAsset.message_id.in_(identities))
                .order_by(VisualAssistantMessageAsset.position)
            ):
                links[link.message_id].append(link.asset_id)
        frozen = FrozenConversation(project.title, list(canvas.nodes or []), row, transcript, links)
        self.db.expunge_all()
        await self.db.rollback()
        return frozen

    async def start(self, project_id, conversation_id, body):
        try:
            return await self.prepare(project_id, conversation_id, body)
        except TurnConflict as exc:
            await self.db.rollback()
            current = await self.conversations.get(project_id, conversation_id)
            raise RevisionConflictError(
                exc.expected, exc.actual, current.model_dump(mode="json")
            ) from exc

    async def prepare(self, project_id, conversation_id, body):
        frozen = await self.read(project_id, conversation_id, body)
        scope = RunScope(project_id=project_id, conversation_id=conversation_id, run_id=new_id())
        peer = AssistantModelClient(
            self.state.capabilities, self.peers.assertion, self.source, scope
        )
        parts = normalize_content_parts(body.content_parts)
        selected = (
            list(dict.fromkeys(part["asset_id"] for part in parts if part["type"] == "asset"))
            if parts
            else body.asset_ids
        )
        prior = {identity for refs in frozen.links.values() for identity in refs}
        for receipt in await pending_outcomes(self.db, project_id, (conversation_id,)):
            await self.state.reference_delivery.deliver(self.owner, receipt)

        prepared = None
        if set(selected) - prior:
            prepared = await self.peers.prepare(
                self.db,
                project_id,
                conversation_id,
                body.expected_revision,
                uuid4().hex,
                retained=prior | set(selected),
            )
        write_attempted = False
        try:
            turn, user_content, assets = await self.plan(scope, body, frozen, peer, parts, selected)

            async def save():
                await self.persist(
                    turn, body, frozen.next_position, parts, user_content, selected, assets
                )
                return turn

            write_attempted = True
            if prepared:
                return await self.peers.references.commit_source(self.db, prepared, save)
            response = await save()
            await self.db.commit()
            return response
        except BaseException:
            await self.db.rollback()
            if prepared and not write_attempted:
                await self.peers.references.abort_after_rollback(self.db, prepared)
            await self.dispatches.cancel_before_stream(self.owner, scope.run_id)
            raise

    async def plan(self, scope, body, frozen, peer, parts, selected):
        project, conversation = scope.project_id, scope.conversation_id
        complete = frozen.completed
        ids = set(selected)
        ids.update(identity for item in complete for identity in frozen.links[item.id])
        assets = await self.peers.input_assets(project, conversation, ids)
        user_content = content_projection(parts, assets, for_model=False) if parts else body.content
        messages = [
            model_message(
                item.role,
                item.content,
                item.content_parts,
                [assets[key] for key in frozen.links[item.id]],
            )[0]
            for item in complete
        ]
        user_message, warnings = model_message(
            "user", user_content, parts, [assets[key] for key in selected]
        )
        messages.append(user_message)
        context = await self.peers.canvas_context(
            project,
            conversation,
            {node["asset_id"] for node in frozen.nodes if node.get("asset_id")},
        )
        system, canvas_summary = canvas_context(frozen.project_title, frozen.nodes, context)
        catalog = await self.peers.models()
        vision = any(message.images for message in messages)
        model, changed = choose_model(catalog, frozen.row.model_id, vision)
        trace_id = new_id()
        await self.dispatches.prepare(self.owner, scope, trace_id)
        model_plan = await peer.begin(
            AssistantRunStart(
                **scope.model_dump(),
                trace_id=trace_id,
                model_id=model.id,
                require_vision=vision,
                tools_enabled="tools" in model.capabilities,
                request_summary={
                    "project_id": project,
                    "conversation_id": conversation,
                    "message_count": len(messages),
                    "asset_ids": selected,
                    "attachment_count": len(selected),
                    "content_part_count": len(parts),
                    "generation_models": {
                        "image": frozen.row.image_model_id,
                        "video": frozen.row.video_model_id,
                    },
                    "canvas": canvas_summary,
                },
            )
        )
        turn = PreparedTurn(
            owner=self.owner,
            scope=scope,
            trace_id=trace_id,
            turn_id=new_id(),
            message_id=new_id(),
            revision=body.expected_revision + 1,
            canvas_revision=body.canvas_revision,
            model=model_plan,
            model_changed_from=changed,
            image_model_id=frozen.row.image_model_id,
            video_model_id=frozen.row.video_model_id,
            image_model_slug=catalog.slugs.get(frozen.row.image_model_id, ""),
            video_model_slug=catalog.slugs.get(frozen.row.video_model_id, ""),
            system=system,
            messages=messages,
            warnings=warnings,
            peer=peer,
        )
        return turn, user_content, assets

    async def persist(self, turn, body, position, parts, content, selected, assets):
        db, scope = self.db, turn.scope
        await db.execute(text("BEGIN IMMEDIATE"))
        row = await self.conversations.row(scope.project_id, scope.conversation_id)
        canvas = await self.conversations.projects.canvas_row(scope.project_id)
        check_versions(row, canvas, body)
        if await db.scalar(
            select(VisualAssistantMessage.id)
            .where(
                VisualAssistantMessage.conversation_id == row.id,
                VisualAssistantMessage.status == "pending",
            )
            .limit(1)
        ):
            raise busy()
        dispatch = await db.get(VisualAssistantDispatch, scope.run_id)
        if dispatch is None or dispatch.phase != "preparing":
            raise ProjectResourceError("对话运行已变化", "assistant_run_changed", 409)
        user = VisualAssistantMessage(
            conversation_id=row.id,
            position=position,
            turn_id=turn.turn_id,
            role="user",
            content=content.strip(),
            content_parts=parts,
            status="completed",
        )
        assistant = VisualAssistantMessage(
            id=turn.message_id,
            conversation_id=row.id,
            position=position + 1,
            turn_id=turn.turn_id,
            role="assistant",
            model_slug=turn.model.model_slug,
            status="pending",
        )
        db.add_all([user, assistant])
        await db.flush()
        db.add_all(
            VisualAssistantMessageAsset(message_id=user.id, asset_id=identity, position=index)
            for index, identity in enumerate(selected)
        )
        if position == 0 and row.title == "AI 助手对话":
            compact = " ".join(content.split())
            if compact:
                row.title = compact[:24] + ("…" if len(compact) > 24 else "")
            elif selected:
                row.title = assets[selected[0]].display_name[:120]
        row.model_id, row.revision, row.updated_at = turn.model.id, turn.revision, utc_now()
        dispatch.message_id, dispatch.phase = assistant.id, "streaming"


def check_versions(row, canvas, body):
    if canvas.revision != body.canvas_revision:
        raise TurnConflict(body.canvas_revision, canvas.revision)
    if row.revision != body.expected_revision:
        raise TurnConflict(body.expected_revision, row.revision)


def model_message(role, content, parts, assets):
    images = {
        asset.id: ImageInput(**asset.image.model_dump())
        for asset in assets
        if asset.image is not None
    }
    documents = {
        asset.id: (asset.text, asset.warning) for asset in assets if asset.media_kind == "document"
    }
    text, image_inputs, warnings = message_input(content, assets, parts, images, documents)
    return AgentMessage(role=role, text=text, images=image_inputs), warnings


def choose_model(catalog, previous, vision):
    options = [model for model in catalog.options if not vision or "vision" in model.capabilities]
    if not options:
        message = (
            "没有可用的视觉对话模型，请先启用支持 chat 和 vision 的模型"
            if vision
            else "没有可用的文本对话模型，请先在模型服务中启用 chat 模型"
        )
        raise ProjectResourceError(message, "assistant_model_unavailable", 409)
    current = next((model for model in options if model.id == previous), None)
    if current is not None:
        return current, None
    return options[0], catalog.slugs.get(previous) or ("不可用模型" if previous else None)


def busy():
    return ProjectResourceError("当前对话正在生成，请稍候", "conversation_busy", 409)
