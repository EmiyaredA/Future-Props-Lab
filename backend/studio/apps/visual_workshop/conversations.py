"""Owned Visual assistant conversations with explicit read projections and CAS."""

from collections import defaultdict
from uuid import uuid4

from sqlalchemy import select, text

from studio.apps.visual_workshop.assistant_values import action_out, message_out
from studio.apps.visual_workshop.schemas.workshop import (
    VisualAssistantConversationListOut,
    VisualAssistantConversationOut,
    VisualAssistantConversationSummaryOut,
    VisualAssistantModelOptionListOut,
)
from studio.apps.visual_workshop.storage.assistant_dispatch_records import VisualAssistantDispatch
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
)
from studio.runtime.ids import new_id
from studio.runtime.project_errors import ProjectResourceError
from studio.runtime.time import iso_utc, utc_now

from .canvas_writes import conflict
from .projects import Projects

MODEL_LABELS = {"model": "对话", "image_model": "图像生成", "video_model": "视频生成"}


def summary(row, models):
    return VisualAssistantConversationSummaryOut(
        id=row.id,
        project_id=row.project_id,
        title=row.title,
        model_id=row.model_id,
        model_slug=models.slugs.get(row.model_id, ""),
        image_model_id=row.image_model_id,
        image_model_slug=models.slugs.get(row.image_model_id, ""),
        video_model_id=row.video_model_id,
        video_model_slug=models.slugs.get(row.video_model_id, ""),
        revision=row.revision,
        created_at=iso_utc(row.created_at),
        updated_at=iso_utc(row.updated_at),
    )


def detail(row, models, messages=()):
    return VisualAssistantConversationOut(
        **summary(row, models).model_dump(), messages=list(messages)
    )


class Conversations:
    def __init__(self, session, owner, peers):
        self.session, self.owner, self.peers = session, owner, peers
        self.projects = Projects(session, owner)

    async def row(self, project_id, conversation_id):
        row = await self.session.scalar(
            select(VisualAssistantConversation).where(
                VisualAssistantConversation.project_id == project_id,
                VisualAssistantConversation.id == conversation_id,
                VisualAssistantConversation.owner_user_id == self.owner,
            )
        )
        if row is None:
            raise ProjectResourceError("对话不存在")
        return row

    async def list(self, project_id):
        await self.projects.row(project_id)
        rows = list(
            await self.session.scalars(
                select(VisualAssistantConversation)
                .where(VisualAssistantConversation.project_id == project_id)
                .order_by(
                    VisualAssistantConversation.updated_at.desc(),
                    VisualAssistantConversation.created_at.desc(),
                )
            )
        )
        if not rows:
            return VisualAssistantConversationListOut(items=[])
        self.session.expunge_all()
        await self.session.rollback()
        models = await self.peers.models()
        return VisualAssistantConversationListOut(items=[summary(row, models) for row in rows])

    async def model_options(self, project_id):
        await self.projects.row(project_id)
        await self.session.rollback()
        return VisualAssistantModelOptionListOut(items=(await self.peers.models()).options)

    async def transcript(self, project_id, conversation_id):
        messages = list(
            await self.session.scalars(
                select(VisualAssistantMessage)
                .where(VisualAssistantMessage.conversation_id == conversation_id)
                .order_by(VisualAssistantMessage.position)
            )
        )
        ids = [message.id for message in messages]
        links = defaultdict(list)
        for row in await self.session.scalars(
            select(VisualAssistantMessageAsset)
            .where(VisualAssistantMessageAsset.message_id.in_(ids))
            .order_by(VisualAssistantMessageAsset.position)
        ):
            links[row.message_id].append(row.asset_id)
        actions = defaultdict(list)
        for row in await self.session.scalars(
            select(VisualAssistantAction)
            .where(VisualAssistantAction.message_id.in_(ids))
            .order_by(VisualAssistantAction.position)
        ):
            actions[row.message_id].append(action_out(row))
        self.session.expunge_all()
        await self.session.rollback()
        assets = await self.peers.attachments(
            project_id, conversation_id, {key for group in links.values() for key in group}
        )
        return [
            message_out(message, [assets[key] for key in links[message.id]], actions[message.id])
            for message in messages
        ]

    async def get(self, project_id, conversation_id):
        await self.session.execute(text("BEGIN"))
        row = await self.row(project_id, conversation_id)
        messages = await self.transcript(project_id, conversation_id)
        return detail(row, await self.peers.models(), messages)

    async def create(self, project_id):
        await self.projects.row(project_id)
        await self.session.rollback()
        models = await self.peers.models()
        conversation_id = new_id()
        prepared = await self.peers.prepare(
            self.session, project_id, conversation_id, -1, uuid4().hex
        )

        async def save():
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.projects.row(project_id)
            row = VisualAssistantConversation(
                id=conversation_id,
                project_id=project_id,
                owner_user_id=self.owner,
                model_id=models.options[0].id if models.options else None,
            )
            self.session.add(row)
            await self.session.flush()
            return detail(row, models)

        return await self.peers.references.commit_source(self.session, prepared, save)

    async def require_writable(self, row, expected, *, action):
        pending = await self.session.scalar(
            select(VisualAssistantMessage.id)
            .where(
                VisualAssistantMessage.conversation_id == row.id,
                VisualAssistantMessage.status == "pending",
            )
            .limit(1)
        )
        if pending is not None:
            raise ProjectResourceError(f"生成期间不能{action}对话", "conversation_busy", 409)
        if action == "删除" and await self.session.scalar(
            select(VisualAssistantDispatch.run_id)
            .where(VisualAssistantDispatch.conversation_id == row.id)
            .limit(1)
        ):
            raise ProjectResourceError("对话运行仍在结算", "conversation_busy", 409)
        if row.revision != expected:
            project_id, conversation_id = row.project_id, row.id
            await self.session.rollback()
            raise conflict(expected, await self.get(project_id, conversation_id))

    async def patch(self, project_id, conversation_id, body):
        await self.session.execute(text("BEGIN"))
        row = await self.row(project_id, conversation_id)
        await self.require_writable(row, body.expected_revision, action="修改")
        messages = await self.transcript(project_id, conversation_id)
        models = await self.peers.models()
        allowed = {
            "model": {option.id for option in models.options},
            "image_model": set(models.image),
            "video_model": set(models.video),
        }
        updates = body.model_dump(exclude_unset=True, exclude={"expected_revision"})
        if updates.get("title") is None:
            updates.pop("title", None)
        for kind, ids in allowed.items():
            model_id = updates.get(kind + "_id")
            if model_id is not None and model_id not in ids:
                raise ProjectResourceError(
                    f"所选{MODEL_LABELS[kind]}模型已停用或不可用", "model_unavailable", 409
                )
        await self.session.execute(text("BEGIN IMMEDIATE"))
        row = await self.row(project_id, conversation_id)
        await self.require_writable(row, body.expected_revision, action="修改")
        for field, value in updates.items():
            setattr(row, field, value)
        row.revision += 1
        row.updated_at = utc_now()
        await self.session.commit()
        return detail(row, models, messages)

    async def delete(self, project_id, conversation_id, expected_revision):
        row = await self.row(project_id, conversation_id)
        await self.require_writable(row, expected_revision, action="删除")
        await self.session.rollback()
        prepared = await self.peers.prepare(
            self.session, project_id, conversation_id, expected_revision, uuid4().hex
        )
        try:
            await self.session.execute(text("BEGIN IMMEDIATE"))
            row = await self.row(project_id, conversation_id)
            await self.require_writable(row, expected_revision, action="删除")
            await self.session.delete(row)
            await self.peers.references.record(
                self.session, prepared, resource_revision=expected_revision + 1, deleted=True
            )
        except BaseException:
            await self.session.rollback()
            await self.peers.references.abort_after_rollback(self.session, prepared)
            raise
        await self.session.commit()
