"""Export and restore Thought documents in parent-first order with exact identities."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import Field, ValidationError
from sqlalchemy import func, literal, select, text
from sqlalchemy.exc import IntegrityError

from studio.apps.thought_workshop.external_sync.models import (
    ArticleSyncAsset,
    ArticleSyncBinding,
    ArticleSyncStep,
    ArticleSyncTask,
)
from studio.apps.thought_workshop.knowledge_tools.models import (
    ThoughtCheckpoint,
    ThoughtDocumentReference,
    ThoughtReadingState,
    ThoughtSavedFilter,
    ThoughtTemplate,
    ThoughtTemplateAsset,
)
from studio.apps.thought_workshop.knowledge_tools.references import reference_ids
from studio.apps.thought_workshop.multitable.models import (
    DataAsset,
    DataChange,
    DataField,
    DataRecord,
    DataTable,
    DataView,
)
from studio.apps.thought_workshop.publication.models import ArticleMember as ArticleMemberRow
from studio.apps.thought_workshop.publication.models import (
    CommunityFavorite as CommunityFavoriteRow,
)
from studio.apps.thought_workshop.publication.models import CommunityUpload as CommunityUploadRow
from studio.apps.thought_workshop.publication.models import (
    OfficialImportReceipt as OfficialReceiptRow,
)
from studio.apps.thought_workshop.publication.models import OfficialSource as OfficialSourceRow
from studio.apps.thought_workshop.publication.models import Publication as PublicationRow
from studio.apps.thought_workshop.publication.models import PublishedArticle as PublishedArticleRow
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.storage.models import (
    ThoughtHistoryAsset,
    ThoughtKnowledgeBase,
    ThoughtNote,
    ThoughtNoteAsset,
    ThoughtNoteHistory,
)
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.contracts.thought_workshop.migration import PIN_CURSOR
from studio.runtime.database.migration_receipts import batch_receipt, has_receipt, record_receipt
from studio.runtime.database.project_operations import ProjectOperationReceipt

from .migration_multitable import (
    ENTITY,
    NOTE_CHILDREN,
    TABLE_CHILDREN,
    Attachment,
    Change,
    Column,
    Record,
    Table,
    View,
    record_note_links,
    table_note,
)
from .migration_pins import template_files
from .migration_sync_records import (
    SyncAsset,
    SyncBinding,
    SyncStep,
    SyncTask,
    legacy_task,
    validate_sync,
)
from .migration_workspace_records import (
    ArticleMember,
    Checkpoint,
    CommunityFavorite,
    CommunityUpload,
    NoteOperationReceipt,
    OfficialImportReceipt,
    OfficialSource,
    Publication,
    PublishedArticle,
    ReadingState,
    SavedFilter,
    Template,
)

ROOTS, NOTES, HISTORY = "knowledge-bases", "notes", "note-history"
NOTE_CURSOR = rf"^[0-9]{{8}}:{PIN_CURSOR[1:-1]}$"
PAGE = 8


class Knowledge(HistoryRecord):
    id: Identifier
    title: str
    description: str
    cover_asset_id: Identifier | None
    home_note_id: Identifier | None
    revision: int = Field(ge=0)
    deleted_at: datetime | None
    created_at: datetime
    updated_at: datetime


class Note(HistoryRecord):
    cursor: str = Field(pattern=NOTE_CURSOR)
    id: Identifier
    knowledge_base_id: Identifier
    parent_id: Identifier | None
    position: int
    is_home: bool
    title: str
    kind: Literal["note", "multitable"]
    document: dict
    schema_version: int
    search_text: str
    tags: list[str]
    pinned: bool
    favorite: bool
    deleted_at: datetime | None
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class NoteHistory(HistoryRecord):
    id: Identifier
    note_id: Identifier
    revision: int = Field(ge=0)
    title: str
    document: dict
    schema_version: int
    tags: list[str]
    author_id: Identifier | None
    author_name: str
    source: str
    created_at: datetime


@dataclass(frozen=True)
class Dataset:
    suffix: str
    orm: type
    shape: type
    per_page: int = PAGE
    primary: tuple[str, ...] = ("id",)
    primary_pattern: str = PIN_CURSOR[1:-1]
    owner_key: str = "owner_user_id"

    @property
    def name(self):
        return f"thought.{self.suffix}"

    @property
    def key(self):
        return "cursor" if self.suffix == NOTES or self.primary != ("id",) else "id"

    @property
    def page_size(self):
        return self.per_page

    @property
    def batch(self):
        return MigrationBatch[self.shape]

    @property
    def page(self):
        return MigrationPage[self.batch]

    @property
    def cursor_pattern(self):
        if self.suffix == NOTES:
            return NOTE_CURSOR
        return "^" + ":".join([self.primary_pattern] * len(self.primary)) + "$"

    @property
    def key_column(self):
        first, *remaining = (getattr(self.orm, column) for column in self.primary)
        for column in remaining:
            first = first + literal(":") + column
        return first

    def cursor(self, row):
        return ":".join(getattr(row, column) for column in self.primary)


@dataclass(frozen=True)
class RequestReceiptDataset(Dataset):
    @property
    def cursor_pattern(self):
        return PIN_CURSOR[:-1] + r":[0-9A-F]{2,512}$"

    @property
    def key_column(self):
        return getattr(self.orm, self.primary[0]) + literal(":") + func.hex(self.orm.request_id)

    def cursor(self, row):
        return f"{getattr(row, self.primary[0])}:{row.request_id.encode().hex().upper()}"


NOTE_RECEIPTS = RequestReceiptDataset(
    "operation-receipts",
    ProjectOperationReceipt,
    NoteOperationReceipt,
    per_page=1,
    primary=("resource_id", "request_id"),
)


DATASETS = (
    Dataset(ROOTS, ThoughtKnowledgeBase, Knowledge),
    Dataset(NOTES, ThoughtNote, Note),
    Dataset(HISTORY, ThoughtNoteHistory, NoteHistory),
    Dataset("checkpoints", ThoughtCheckpoint, Checkpoint),
    Dataset("data-tables", DataTable, Table, primary_pattern=ENTITY),
    Dataset("data-fields", DataField, Column, primary_pattern=ENTITY),
    Dataset("data-views", DataView, View, primary_pattern=ENTITY),
    Dataset("data-records", DataRecord, Record, primary_pattern=ENTITY),
    Dataset("data-changes", DataChange, Change, per_page=1),
    Dataset("data-assets", DataAsset, Attachment, primary=("note_id", "asset_id")),
    Dataset("templates", ThoughtTemplate, Template, per_page=1),
    Dataset("saved-filters", ThoughtSavedFilter, SavedFilter),
    Dataset("reading-states", ThoughtReadingState, ReadingState),
    Dataset("publications", PublicationRow, Publication),
    Dataset(
        "published-articles",
        PublishedArticleRow,
        PublishedArticle,
        primary=("publication_id", "note_id"),
    ),
    Dataset(
        "article-members",
        ArticleMemberRow,
        ArticleMember,
        primary=("publication_id", "note_id", "user_id"),
    ),
    Dataset(
        "community-favorites",
        CommunityFavoriteRow,
        CommunityFavorite,
        primary=("resource_id",),
        primary_pattern=r"(?:community|official)/[^/]{1,191}",
        owner_key="user_id",
    ),
    Dataset(
        "community-uploads",
        CommunityUploadRow,
        CommunityUpload,
        primary=("note_id", "asset_id"),
    ),
    Dataset("official-sources", OfficialSourceRow, OfficialSource, primary=("note_id",)),
    RequestReceiptDataset(
        "official-import-receipts",
        OfficialReceiptRow,
        OfficialImportReceipt,
        primary=("user_id", "request_id"),
    ),
    NOTE_RECEIPTS,
    Dataset("sync-bindings", ArticleSyncBinding, SyncBinding),
    Dataset("sync-tasks", ArticleSyncTask, SyncTask, per_page=1),
    Dataset("sync-steps", ArticleSyncStep, SyncStep),
    Dataset("sync-assets", ArticleSyncAsset, SyncAsset, primary=("task_id", "asset_id")),
)
TREE = """
WITH RECURSIVE ordered(id, knowledge_base_id, depth) AS (
    SELECT id, knowledge_base_id, 0 FROM thought_notes
    WHERE parent_id IS NULL AND owner_user_id = :owner
    UNION ALL
    SELECT child.id, child.knowledge_base_id, ordered.depth + 1
    FROM thought_notes AS child JOIN ordered ON child.parent_id = ordered.id
    WHERE child.knowledge_base_id = ordered.knowledge_base_id
      AND child.owner_user_id = :owner AND ordered.depth < 99999999
)
"""


def conflict(code):
    return HTTPException(409, {"code": code})


async def read_tree(session, owner, after):
    owners = {"owner": owner}
    count = await session.scalar(
        select(func.count()).select_from(ThoughtNote).where(ThoughtNote.owner_user_id == owner)
    )
    actual = await session.scalar(text(TREE + "SELECT count(*) FROM ordered"), owners)
    if count != actual:
        raise conflict("migration_thought_document_tree_invalid")
    rows = (
        await session.execute(
            text(
                TREE
                + """
        SELECT id, printf('%08d', depth) || ':' || id AS cursor FROM ordered
        WHERE cursor > :after ORDER BY cursor LIMIT :maximum
    """
            ),
            {**owners, "after": after or "", "maximum": PAGE + 1},
        )
    ).all()
    keys = dict(rows)
    notes = (
        await session.scalars(
            select(ThoughtNote).where(ThoughtNote.owner_user_id == owner, ThoughtNote.id.in_(keys))
        )
    ).all()
    return [
        Note.model_validate(
            {
                **{key: getattr(note, key) for key in Note.model_fields if key != "cursor"},
                "cursor": keys[note.id],
            }
        )
        for note in sorted(notes, key=lambda row: keys[row.id])
    ]


def ownership(orm):
    if orm in {ThoughtNoteHistory, ThoughtCheckpoint, CommunityUploadRow} | NOTE_CHILDREN:
        return ThoughtNote, ((ThoughtNote, ThoughtNote.id == orm.note_id),)
    if orm in TABLE_CHILDREN:
        return ThoughtNote, (
            (DataTable, DataTable.id == orm.table_id),
            (ThoughtNote, ThoughtNote.id == DataTable.note_id),
        )
    if orm in {PublishedArticleRow, ArticleMemberRow}:
        return PublicationRow, ((PublicationRow, PublicationRow.id == orm.publication_id),)
    if orm in {ArticleSyncAsset, ArticleSyncStep}:
        return ArticleSyncTask, ((ArticleSyncTask, ArticleSyncTask.id == orm.task_id),)
    return orm, ()


async def inventory(sessions, plan, dataset):
    parent, joins = ownership(dataset.orm)
    owner = getattr(parent, dataset.owner_key)
    query = select(owner, func.count()).select_from(dataset.orm)
    for target, condition in joins:
        query = query.outerjoin(target, condition)
    if dataset is NOTE_RECEIPTS:
        query = query.where(ProjectOperationReceipt.resource_kind == "thought")
    query = query.group_by(owner)
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict((await db.execute(query)).all())
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise conflict("migration_owner_unassigned")
    return {"record_count": sum(counts.values())}


async def page(sessions, plan, dataset, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        if dataset.suffix == NOTES:
            rows = await read_tree(db, str(owner), after)
        else:
            orm = dataset.orm
            parent, joins = ownership(orm)
            query = select(orm)
            for target, condition in joins:
                query = query.join(target, condition)
            if dataset is NOTE_RECEIPTS:
                query = query.where(ProjectOperationReceipt.resource_kind == "thought")
            column = dataset.key_column
            result = await db.scalars(
                query.where(
                    getattr(parent, dataset.owner_key) == str(owner), column > (after or "")
                )
                .order_by(column)
                .limit(dataset.page_size + 1)
            )
            if orm is ArticleSyncTask:
                try:
                    rows = [await legacy_task(db, row) for row in result]
                except ValidationError:
                    raise conflict("migration_thought_sync_history_invalid") from None
            elif dataset.key == "cursor":
                rows = [
                    dataset.shape.model_validate(
                        {
                            **{
                                field: getattr(row, field)
                                for field in dataset.shape.model_fields
                                if field != "cursor"
                            },
                            "cursor": dataset.cursor(row),
                        }
                    )
                    for row in result
                ]
            else:
                rows = [dataset.shape.model_validate(row, from_attributes=True) for row in result]
    batch = dataset.batch(
        dataset=dataset.name,
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset.name}/{owner}/{after or ''}"),
        records=tuple(rows[: dataset.page_size]),
    )
    last = rows[dataset.page_size - 1] if len(rows) > dataset.page_size else None
    return dataset.page(
        batch=batch,
        sha256=batch.digest,
        next_cursor=getattr(last, dataset.key) if last else None,
    )


async def validate_workspace_row(db, dataset, record, owner, allowed_owners):
    if dataset.orm in {ArticleSyncBinding, ArticleSyncTask}:
        await validate_sync(db, record, owner)
    if dataset.orm in {ArticleSyncAsset, ArticleSyncStep}:
        task = await db.get(ArticleSyncTask, record.task_id)
        if task is None or task.owner_user_id != owner:
            raise conflict("migration_thought_sync_task_owner_conflict")
        if dataset.orm is ArticleSyncAsset and record.asset_id not in task.content.get(
            "asset_ids", []
        ):
            raise conflict("migration_thought_sync_asset_unreferenced")
    if dataset is NOTE_RECEIPTS:
        note = await db.get(ThoughtNote, record.resource_id)
        if note is None or note.owner_user_id != owner or record.result["revision"] > note.revision:
            raise conflict("migration_thought_operation_receipt_source_invalid")
    if dataset.orm is ThoughtCheckpoint:
        note = await db.get(ThoughtNote, record.note_id)
        history = await db.get(ThoughtNoteHistory, record.history_id)
        if (
            note is None
            or note.owner_user_id != owner
            or history is None
            or history.note_id != note.id
        ):
            raise conflict("migration_thought_checkpoint_parent_invalid")
    if dataset.orm is PublicationRow:
        book = await db.get(ThoughtKnowledgeBase, record.knowledge_base_id)
        if book is None or book.owner_user_id != owner or record.publisher_id not in allowed_owners:
            raise conflict("migration_thought_publication_parent_invalid")
    if dataset.orm in {PublishedArticleRow, ArticleMemberRow}:
        publication = await db.get(PublicationRow, record.publication_id)
        note = await db.get(ThoughtNote, record.note_id)
        if (
            publication is None
            or publication.owner_user_id != owner
            or note is None
            or note.owner_user_id != owner
            or note.knowledge_base_id != publication.knowledge_base_id
        ):
            raise conflict("migration_thought_article_parent_invalid")
        if dataset.orm is ArticleMemberRow:
            article = await db.get(PublishedArticleRow, (publication.id, note.id))
            if article is None or record.user_id not in allowed_owners:
                raise conflict("migration_thought_article_member_invalid")
    if dataset.orm in {CommunityUploadRow, OfficialSourceRow}:
        note = await db.get(ThoughtNote, record.note_id)
        if note is None or note.owner_user_id != owner:
            raise conflict("migration_thought_publication_note_owner_conflict")
    if (
        dataset.orm in {CommunityUploadRow, OfficialReceiptRow}
        and record.user_id not in allowed_owners
    ):
        raise conflict("migration_thought_actor_unassigned")
    # The account-ownership upgrade retains a former Workspace member's user ID
    # while assigning the Workspace's data to the migrated owner.
    if (
        dataset.orm in {ThoughtReadingState, ThoughtSavedFilter}
        and record.user_id not in allowed_owners
    ):
        raise conflict("migration_thought_preferences_owner_invalid")


async def ingest(sessions, dataset, batch, receipt_model, allowed_owners):
    owner = str(batch.owner_id)
    keys = [getattr(record, dataset.key) for record in batch.records]
    if batch.dataset != dataset.name or keys != sorted(set(keys)) or len(keys) > dataset.page_size:
        raise conflict("migration_thought_batch_invalid")
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(db, receipt_model, receipt):
            return receipt
        for record in batch.records:
            values = record.model_dump(exclude={"cursor"})
            if dataset.suffix == HISTORY:
                note = await db.get(ThoughtNote, record.note_id)
                if note is None or note.owner_user_id != owner or record.revision > note.revision:
                    raise conflict("migration_thought_history_parent_invalid")
            elif not ownership(dataset.orm)[1]:
                values[dataset.owner_key] = owner
            if dataset.suffix == NOTES:
                knowledge = await db.get(ThoughtKnowledgeBase, record.knowledge_base_id)
                parent = await db.get(ThoughtNote, record.parent_id) if record.parent_id else None
                if (
                    knowledge is None
                    or knowledge.owner_user_id != owner
                    or (
                        record.parent_id
                        and (
                            parent is None
                            or parent.owner_user_id != owner
                            or parent.knowledge_base_id != knowledge.id
                        )
                    )
                ):
                    raise conflict("migration_thought_document_parent_invalid")
            if dataset.suffix == NOTES:
                depth, _, identifier = record.cursor.partition(":")
                if (
                    identifier != record.id
                    or (int(depth) == 0) != (parent is None)
                    or record.is_home != (knowledge.home_note_id == record.id)
                    or record.is_home
                    and parent is not None
                ):
                    raise conflict("migration_thought_document_tree_invalid")
            if (
                dataset.suffix != NOTES
                and dataset.key == "cursor"
                and record.cursor != dataset.cursor(record)
            ):
                raise conflict("migration_thought_batch_invalid")
            table_parent = None
            if dataset.orm in NOTE_CHILDREN | TABLE_CHILDREN:
                table_parent = await table_note(db, dataset.orm, record)
                if (
                    table_parent is None
                    or table_parent.owner_user_id != owner
                    or table_parent.kind != "multitable"
                    or (dataset.orm is DataChange and record.revision > table_parent.revision)
                ):
                    raise conflict("migration_thought_table_parent_invalid")
            await validate_workspace_row(db, dataset, record, owner, allowed_owners)
            try:
                db.add(dataset.orm(**values))
                await db.flush()
                if dataset.suffix == NOTES:
                    db.add_all(
                        ThoughtNoteAsset(note_id=record.id, asset_id=asset)
                        for asset in file_ids(record.document)
                    )
                    if record.kind == "note":
                        db.add_all(
                            ThoughtDocumentReference(note_id=record.id, target_id=target)
                            for target in reference_ids(record.document)
                        )
                if dataset.orm is DataRecord:
                    await record_note_links(db, table_parent, record)
                if dataset.orm is ThoughtTemplate:
                    db.add_all(
                        ThoughtTemplateAsset(template_id=record.id, asset_id=asset)
                        for asset in template_files(record)
                    )
                if dataset.suffix == HISTORY:
                    db.add_all(
                        ThoughtHistoryAsset(history_id=record.id, asset_id=asset)
                        for asset in file_ids(record.document)
                    )
                await db.flush()
            except IntegrityError:
                raise conflict("migration_thought_identity_conflict") from None
        record_receipt(db, receipt_model, receipt)
        await db.commit()
    return receipt
