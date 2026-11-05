"""Transfer Amadeus's owned dialogue, runtime snapshots and event records."""

from datetime import datetime
from functools import partial
from typing import Literal

from pydantic import Field
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase

from studio.apps.amadeus.storage.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier, ProjectRecord
from studio.runtime.database.migration_apps import mount_dataset
from studio.runtime.database.migration_receipts import (
    ImportReceiptFields,
    batch_receipt,
    has_receipt,
    record_receipt,
)
from studio.runtime.database.project_history_migration import (
    ProjectDataset,
    blocked,
    inventory,
    read_page,
)


class ReceiptBase(DeclarativeBase):
    pass


class AmadeusImportReceipt(ImportReceiptFields, ReceiptBase):
    __tablename__ = "amadeus_import_receipts"


class Conversation(ProjectRecord):
    user_id: Identifier
    executor_kind: str
    agent_id: str | None
    model_id: str | None


class Run(HistoryRecord):
    id: Identifier
    conversation_id: Identifier
    user_id: Identifier
    agent_id: str | None
    agent_model: str
    execution_config: dict
    model_id: str
    mode: str
    status: str
    active_owner_key: str | None
    context_json: list[dict]
    references_json: list[dict]
    capabilities_json: list[str]
    partial_text: str
    last_event_sequence: int = Field(ge=0)
    heartbeat_at: datetime
    error_message: str | None
    response_message_id: Identifier | None
    created_at: datetime
    updated_at: datetime
    finished_at: datetime | None


class RunLink(HistoryRecord):
    id: Identifier
    source_run_id: Identifier


class DialogueChild(HistoryRecord):
    id: Identifier
    conversation_id: Identifier
    run_id: Identifier | None
    created_at: datetime


class Message(DialogueChild):
    role: str
    content: str
    references_json: list[dict]
    status: str


class Action(DialogueChild):
    user_id: Identifier
    tool_name: str
    arguments_json: dict
    arguments_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    status: str
    result_json: dict | None
    updated_at: datetime


class Question(DialogueChild):
    run_id: Identifier
    user_id: Identifier
    tool_call_id: str
    prompt: str
    options_json: list[str]
    allow_text: bool
    status: str
    answer_json: dict | None
    updated_at: datetime


class Event(HistoryRecord):
    id: Identifier
    run_id: Identifier
    sequence: int = Field(gt=0)
    kind: str
    payload_json: dict
    idempotency_key: str
    created_at: datetime


class ConversationBatch(MigrationBatch[Conversation]):
    dataset: Literal["amadeus.conversations"]


class RunBatch(MigrationBatch[Run]):
    dataset: Literal["amadeus.runs"]


class RunLinkBatch(MigrationBatch[RunLink]):
    dataset: Literal["amadeus.run-links"]


class MessageBatch(MigrationBatch[Message]):
    dataset: Literal["amadeus.messages"]


class ActionBatch(MigrationBatch[Action]):
    dataset: Literal["amadeus.actions"]


class QuestionBatch(MigrationBatch[Question]):
    dataset: Literal["amadeus.questions"]


class EventBatch(MigrationBatch[Event]):
    dataset: Literal["amadeus.run-events"]


async def verify_actor(session, record):
    conversation = await session.get(AmadeusConversation, record.conversation_id)
    if conversation is None or conversation.user_id != record.user_id:
        raise blocked("migration_amadeus_actor_conflict")


async def verify_dialogue_child(session, record):
    if isinstance(record, (Action, Question)):
        await verify_actor(session, record)
    if record.run_id is not None:
        run = await session.get(AmadeusRun, record.run_id)
        if run is None or run.conversation_id != record.conversation_id:
            raise blocked("migration_amadeus_run_conversation_conflict")


async def verify_event(session, record):
    run = await session.get(AmadeusRun, record.run_id)
    if run is None or record.sequence > run.last_event_sequence:
        raise blocked("migration_amadeus_event_sequence_invalid")


class RunLinkDataset(ProjectDataset):
    def select(self, *columns):
        return super().select(*columns).where(self.model.source_run_id.is_not(None))


LINKS = RunLinkDataset(
    "amadeus.run-links",
    AmadeusRun,
    RunLink,
    RunLinkBatch,
    MigrationPage[RunLinkBatch],
    page_size=32,
)
DATASETS = (
    ProjectDataset(
        "amadeus.conversations",
        AmadeusConversation,
        Conversation,
        ConversationBatch,
        MigrationPage[ConversationBatch],
        page_size=32,
    ),
    ProjectDataset(
        "amadeus.runs",
        AmadeusRun,
        Run,
        RunBatch,
        MigrationPage[RunBatch],
        project=AmadeusConversation,
        parent_key="conversation_id",
        validate=verify_actor,
    ),
    ProjectDataset(
        "amadeus.messages",
        AmadeusMessage,
        Message,
        MessageBatch,
        MigrationPage[MessageBatch],
        project=AmadeusConversation,
        parent_key="conversation_id",
        validate=verify_dialogue_child,
        page_size=4,
    ),
    ProjectDataset(
        "amadeus.actions",
        AmadeusAction,
        Action,
        ActionBatch,
        MigrationPage[ActionBatch],
        project=AmadeusConversation,
        parent_key="conversation_id",
        validate=verify_dialogue_child,
        page_size=8,
    ),
    ProjectDataset(
        "amadeus.questions",
        AmadeusQuestion,
        Question,
        QuestionBatch,
        MigrationPage[QuestionBatch],
        project=AmadeusConversation,
        parent_key="conversation_id",
        validate=verify_dialogue_child,
        page_size=32,
    ),
    ProjectDataset(
        "amadeus.run-events",
        AmadeusRunEvent,
        Event,
        EventBatch,
        MigrationPage[EventBatch],
        project=AmadeusRun,
        parent_key="run_id",
        validate=verify_event,
        page_size=8,
    ),
)


async def import_links(sessions, batch):
    ids = [record.id for record in batch.records]
    if ids != sorted(set(ids)) or len(ids) > LINKS.page_size:
        raise blocked("migration_amadeus_run_links_invalid")
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": str(batch.owner_id)}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(session, AmadeusImportReceipt, receipt):
            return receipt
        for record in batch.records:
            run = await session.get(AmadeusRun, record.id)
            parent = await session.get(AmadeusRun, record.source_run_id)
            if (
                run is None
                or parent is None
                or run.id == parent.id
                or run.conversation_id != parent.conversation_id
                or run.source_run_id is not None
            ):
                raise blocked("migration_amadeus_run_links_invalid")
            run.source_run_id = parent.id
        record_receipt(session, AmadeusImportReceipt, receipt)
        try:
            await session.flush()
            connected, total = (await session.execute(text(RUN_COUNT))).one()
            if connected != total:
                raise blocked("migration_amadeus_run_graph_invalid")
            await session.commit()
        except IntegrityError:
            raise blocked("migration_amadeus_run_links_conflict") from None
    return receipt


def mount_links(app, plan, sessions, prefix, source):
    mount_dataset(
        app,
        prefix=prefix + "/run-links",
        plan=plan,
        cursor_pattern=LINKS.cursor_pattern,
        batch_model=LINKS.batch,
        page_model=LINKS.page,
        inventory=partial(inventory, sessions, plan, LINKS),
        page=partial(read_page, sessions, plan, LINKS),
        ingest=partial(import_links, sessions) if source is None else None,
        source=source,
    )


INVALID = """
SELECT 1 FROM amadeus_runs r
LEFT JOIN amadeus_runs p ON p.id = r.source_run_id
LEFT JOIN amadeus_messages m ON m.id = r.response_message_id
WHERE (r.source_run_id IS NOT NULL AND (
    p.id IS NULL OR p.owner_user_id != r.owner_user_id OR p.conversation_id != r.conversation_id
)) OR (r.response_message_id IS NOT NULL AND (
    m.id IS NULL OR m.owner_user_id != r.owner_user_id OR m.conversation_id != r.conversation_id
    OR m.run_id IS NULL OR m.run_id != r.id OR m.role != 'assistant'
))
LIMIT 1
"""

RUN_COUNT = """
WITH RECURSIVE ordered(id) AS (
    SELECT id FROM amadeus_runs WHERE source_run_id IS NULL
    UNION ALL
    SELECT child.id FROM amadeus_runs child JOIN ordered ON ordered.id = child.source_run_id
)
SELECT (SELECT count(*) FROM ordered), (SELECT count(*) FROM amadeus_runs)
"""


async def verify_history(sessions):
    async with sessions(info={"allow_system_reads": True}) as session:
        if await session.scalar(text(INVALID)) is not None:
            raise blocked("migration_amadeus_run_relationship_invalid")
        connected, total = (await session.execute(text(RUN_COUNT))).one()
        if connected != total:
            raise blocked("migration_amadeus_run_graph_invalid")
        events = (
            select(
                AmadeusRunEvent.run_id,
                func.count().label("total"),
                func.max(AmadeusRunEvent.sequence).label("last"),
            )
            .group_by(AmadeusRunEvent.run_id)
            .subquery()
        )
        invalid = await session.scalar(
            select(AmadeusRun.id)
            .outerjoin(events, events.c.run_id == AmadeusRun.id)
            .where(
                (func.coalesce(events.c.total, 0) != AmadeusRun.last_event_sequence)
                | (func.coalesce(events.c.last, 0) != AmadeusRun.last_event_sequence)
            )
            .limit(1)
        )
        if invalid is not None:
            raise blocked("migration_amadeus_event_coverage_invalid")
    return {"record_count": total}
