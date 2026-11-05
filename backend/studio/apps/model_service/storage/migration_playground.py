"""Transfer model testing conversations, messages, and draft or sent attachments."""

from datetime import datetime
from typing import Literal

from pydantic import Field

from studio.apps.model_service.playground.attachments import MAX_ATTACHMENT_BYTES
from studio.apps.model_service.storage.migration_originals import StorageKey
from studio.apps.model_service.storage.models.model_service import ModelEntry
from studio.apps.model_service.storage.models.model_test import (
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestMessage,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier, ProjectRecord
from studio.contracts.model_service.schemas.model_test import MessageStatus
from studio.runtime.database.project_history_migration import ProjectDataset, blocked


class Conversation(ProjectRecord):
    model_id: Identifier | None
    system_prompt: str = Field(repr=False)
    temperature: float
    max_tokens: int


class Message(HistoryRecord):
    id: Identifier
    conversation_id: Identifier
    position: int = Field(ge=0)
    turn_id: Identifier
    role: Literal["user", "assistant"]
    content: str = Field(repr=False)
    model_slug: str
    status: MessageStatus
    error_message: str | None = Field(repr=False)
    created_at: datetime
    updated_at: datetime


class Attachment(HistoryRecord):
    id: Identifier
    conversation_id: Identifier
    message_id: Identifier | None
    position: int = Field(ge=0)
    original_filename: str
    storage_key: StorageKey
    mime_type: str
    byte_size: int = Field(gt=0, le=MAX_ATTACHMENT_BYTES)
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    created_at: datetime


class Conversations(MigrationBatch[Conversation]):
    dataset: Literal["models.test-conversations"]


class Messages(MigrationBatch[Message]):
    dataset: Literal["models.test-messages"]


class Attachments(MigrationBatch[Attachment]):
    dataset: Literal["models.test-attachments"]


async def validate_conversation(session, item):
    if item.model_id:
        model = await session.get(ModelEntry, item.model_id)
        if model is None or model.owner_user_id != session.info["owner_user_id"]:
            raise blocked("migration_model_test_model_conflict")


async def validate_attachment(session, item):
    if item.message_id:
        message = await session.get(ModelTestMessage, item.message_id)
        if message is None or message.conversation_id != item.conversation_id:
            raise blocked("migration_model_test_attachment_message_conflict")


DATASETS = (
    ProjectDataset(
        "models.test-conversations",
        ModelTestConversation,
        Conversation,
        Conversations,
        MigrationPage[Conversations],
        validate=validate_conversation,
    ),
    ProjectDataset(
        "models.test-messages",
        ModelTestMessage,
        Message,
        Messages,
        MigrationPage[Messages],
        project=ModelTestConversation,
        owns_record=False,
        parent_key="conversation_id",
    ),
    ProjectDataset(
        "models.test-attachments",
        ModelTestAttachment,
        Attachment,
        Attachments,
        MigrationPage[Attachments],
        project=ModelTestConversation,
        owns_record=False,
        parent_key="conversation_id",
        page_size=64,
        validate=validate_attachment,
    ),
)
