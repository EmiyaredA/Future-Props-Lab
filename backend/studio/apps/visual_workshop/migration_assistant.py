"""Historical Visual conversations and their project-owned transcript records."""

from datetime import datetime
from typing import Literal

from pydantic import Field
from sqlalchemy import and_, select

from studio.apps.visual_workshop.schemas.workshop import (
    VisualAssistantActionStatus,
    VisualAssistantMessageStatus,
)
from studio.apps.visual_workshop.storage.models import (
    VisualAssistantAction,
    VisualAssistantConversation,
    VisualAssistantMessage,
    VisualAssistantMessageAsset,
    VisualGenerationTask,
    VisualWorkshopProject,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.project_history_migration import ProjectDataset, blocked

Conversation = VisualAssistantConversation
Message = VisualAssistantMessage
Project = VisualWorkshopProject


class ConversationRecord(HistoryRecord):
    id: Identifier
    project_id: Identifier
    title: str = Field(min_length=1, max_length=120)
    model_id: Identifier | None
    image_model_id: Identifier | None
    video_model_id: Identifier | None
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime


class MessageRecord(HistoryRecord):
    id: Identifier
    conversation_id: Identifier
    position: int = Field(ge=0, strict=True)
    turn_id: Identifier
    role: Literal["user", "assistant"]
    content: str
    content_parts: list[dict]
    model_slug: str = Field(max_length=160)
    status: VisualAssistantMessageStatus
    error_message: str | None
    created_at: datetime
    updated_at: datetime


class AttachmentRecord(HistoryRecord):
    id: Identifier
    message_id: Identifier
    asset_id: Identifier
    position: int = Field(ge=0, strict=True)


class ActionRecord(HistoryRecord):
    id: Identifier
    message_id: Identifier
    action_id: str = Field(min_length=1, max_length=160)
    run_id: Identifier
    approval_group_id: Identifier | None
    position: int = Field(ge=0, strict=True)
    tool_name: str = Field(min_length=1, max_length=100)
    effect: Literal["read", "write", "external"]
    status: VisualAssistantActionStatus
    display_payload: dict
    result_payload: dict
    error_message: str | None
    duration_ms: int | None = Field(ge=0, strict=True)
    canvas_revision: int | None = Field(ge=0, strict=True)
    generation_task_id: Identifier | None
    created_at: datetime
    updated_at: datetime


class Conversations(MigrationBatch[ConversationRecord]):
    dataset: Literal["visual.assistant-conversations"]


class Messages(MigrationBatch[MessageRecord]):
    dataset: Literal["visual.assistant-messages"]


class Attachments(MigrationBatch[AttachmentRecord]):
    dataset: Literal["visual.assistant-attachments"]


class Actions(MigrationBatch[ActionRecord]):
    dataset: Literal["visual.assistant-actions"]


def project_join():
    return and_(
        Project.id == Conversation.project_id, Project.owner_user_id == Conversation.owner_user_id
    )


class TranscriptDataset(ProjectDataset):
    @property
    def owner_column(self):
        return Project.owner_user_id

    def select(self, *columns):
        query = select(*columns).select_from(self.model)
        if self.model is not Message:
            query = query.outerjoin(Message, Message.id == self.model.message_id)
        return query.outerjoin(Conversation, Conversation.id == Message.conversation_id).outerjoin(
            Project, project_join()
        )


async def require_conversation(session, conversation_id):
    row = await session.scalar(
        select(Conversation)
        .join(Project, project_join())
        .where(
            Conversation.id == conversation_id,
            Project.owner_user_id == session.info["owner_user_id"],
        )
    )
    if row is None:
        raise blocked("migration_visual_conversation_owner_conflict")
    return row


async def validate_message(session, record):
    await require_conversation(session, record.conversation_id)


async def attachment_parent(session, message_id):
    message = await session.get(Message, message_id)
    if message is None:
        raise blocked("migration_visual_message_missing")
    return await require_conversation(session, message.conversation_id)


async def validate_attachment(session, record):
    await attachment_parent(session, record.message_id)


async def validate_action(session, record):
    conversation = await attachment_parent(session, record.message_id)
    if record.generation_task_id:
        task = await session.get(VisualGenerationTask, record.generation_task_id)
        if (
            task is None
            or task.project_id != conversation.project_id
            or task.owner_user_id != conversation.owner_user_id
        ):
            raise blocked("migration_visual_action_task_conflict")


DATASETS = (
    ProjectDataset(
        "visual.assistant-conversations",
        Conversation,
        ConversationRecord,
        Conversations,
        MigrationPage[Conversations],
        project=Project,
    ),
    TranscriptDataset(
        "visual.assistant-messages",
        Message,
        MessageRecord,
        Messages,
        MigrationPage[Messages],
        owns_record=False,
        validate=validate_message,
    ),
    TranscriptDataset(
        "visual.assistant-attachments",
        VisualAssistantMessageAsset,
        AttachmentRecord,
        Attachments,
        MigrationPage[Attachments],
        owns_record=False,
        validate=validate_attachment,
    ),
    TranscriptDataset(
        "visual.assistant-actions",
        VisualAssistantAction,
        ActionRecord,
        Actions,
        MigrationPage[Actions],
        owns_record=False,
        validate=validate_action,
    ),
)
