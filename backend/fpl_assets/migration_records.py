"""Export and import account library records before transferring their original bytes."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import column, func, or_, select, table, text
from sqlalchemy.exc import IntegrityError

from app.capabilities.asset_store.asset_scope import is_library_asset
from app.capabilities.asset_store.models import VisualAsset, VisualAssetFolder
from fpl_runtime.migration_batches import MAX_RECORDS, BatchReceipt, MigrationBatch, MigrationPage

from .migration_models import AssetImportReceipt
from .models import VisualProjectFileLink

ID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
AssetID = Annotated[str, Field(pattern=f"^{ID}$")]
FOLDER_CURSOR = rf"^[0-9]{{5}}:{ID}$"
ASSET_CURSOR = rf"^{ID}$"


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: AssetID
    project_id: AssetID | None
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime


class FolderRecord(Record):
    parent_id: AssetID | None
    name: str = Field(min_length=1, max_length=120)
    depth: int = Field(ge=0, le=99999, strict=True)
    cursor: str = Field(pattern=FOLDER_CURSOR)

    @model_validator(mode="after")
    def order(self):
        if self.cursor != f"{self.depth:05d}:{self.id}" or (self.depth == 0) != (
            self.parent_id is None
        ):
            raise ValueError("文件夹顺序无效")
        return self


class AssetRecord(Record):
    galgame_project_id: AssetID | None
    video_editor_project_id: AssetID | None
    motion_compositor_project_id: AssetID | None
    folder_id: AssetID | None
    original_filename: str = Field(min_length=1, max_length=255)
    display_name: str = Field(max_length=255)
    storage_key: str = Field(pattern=r"^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$")
    storage_version: Literal[1, 2]
    media_kind: Literal["audio", "image", "video", "font", "document"]
    mime_type: str = Field(pattern=r"^[a-z0-9.+-]+/[a-z0-9.+-]+$", max_length=120)
    byte_size: int = Field(gt=0, strict=True)

    @model_validator(mode="after")
    def owned_scope(self):
        scopes = [
            scope
            for scope in (
                self.project_id,
                self.galgame_project_id,
                self.video_editor_project_id,
                self.motion_compositor_project_id,
            )
            if scope is not None
        ]
        if len(scopes) > 1 or (self.folder_id is not None and scopes and self.project_id is None):
            raise ValueError("素材项目或文件夹归属冲突")
        return self


class ProjectLinkRecord(Record):
    project_id: AssetID
    asset_id: AssetID
    folder_id: AssetID | None
    display_name: str = Field(max_length=255)


LEGACY_VISUAL_LINKS = table(
    "visual_project_asset_references",
    *[column(item.name, item.type) for item in VisualProjectFileLink.__table__.columns],
)
LEGACY_VISUAL_PROJECTS = table("visual_workshop_projects", column("id"), column("owner_user_id"))


class Folders(MigrationBatch[FolderRecord]):
    dataset: Literal["assets.folders"]


class Files(MigrationBatch[AssetRecord]):
    dataset: Literal["assets.files"]


class ProjectLinks(MigrationBatch[ProjectLinkRecord]):
    dataset: Literal["assets.visual-links"]


@dataclass(frozen=True)
class Dataset:
    name: str
    model: type
    record: type[Record]
    batch: type[MigrationBatch]
    page: type[MigrationPage]
    key: str
    cursor: str
    source_table: object | None = None


DATASETS = (
    Dataset(
        "assets.folders",
        VisualAssetFolder,
        FolderRecord,
        Folders,
        MigrationPage[Folders],
        "cursor",
        FOLDER_CURSOR,
    ),
    Dataset(
        "assets.files", VisualAsset, AssetRecord, Files, MigrationPage[Files], "id", ASSET_CURSOR
    ),
    Dataset(
        "assets.visual-links",
        VisualProjectFileLink,
        ProjectLinkRecord,
        ProjectLinks,
        MigrationPage[ProjectLinks],
        "id",
        ASSET_CURSOR,
        source_table=LEGACY_VISUAL_LINKS,
    ),
)


def invalid(code="migration_asset_record_invalid"):
    return HTTPException(409, {"code": code})


async def inventory(sessions, plan, dataset, *, legacy=False):
    source = dataset.source_table if legacy else None
    owner = source.c.owner_user_id if source is not None else dataset.model.owner_user_id
    async with sessions(info={"allow_system_reads": True}) as db:
        if source is not None:
            project = LEGACY_VISUAL_PROJECTS.c
            conflicts = await db.scalar(
                select(func.count())
                .select_from(source)
                .outerjoin(LEGACY_VISUAL_PROJECTS, source.c.project_id == project.id)
                .where(or_(project.id.is_(None), project.owner_user_id != owner))
            )
            if conflicts:
                raise invalid("migration_visual_link_owner_conflict")
        counts = dict((await db.execute(select(owner, func.count()).group_by(owner))).all())
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise invalid("migration_owner_unassigned")
    return {"record_count": sum(counts.values())}


def ordered_folders(rows):
    by_id = {row.id: row for row in rows}
    depths = {}
    for item in rows:
        chain, seen = [], set()
        current = item
        while current is not None and current.id not in depths:
            if current.id in seen:
                raise invalid("migration_folder_cycle")
            seen.add(current.id)
            chain.append(current.id)
            if current.parent_id is None:
                current = None
            else:
                parent = by_id.get(current.parent_id)
                if parent is None or parent.project_id != current.project_id:
                    raise invalid("migration_folder_parent_conflict")
                current = parent
        depth = -1 if current is None else depths[current.id]
        for key in reversed(chain):
            depth += 1
            depths[key] = depth
    return sorted((f"{depths[row.id]:05d}:{row.id}", depths[row.id], row.id) for row in rows)


async def page_records(db, owner, dataset, after, *, legacy=False):
    if legacy and dataset.source_table is not None:
        table = dataset.source_table
        rows = (
            await db.execute(
                select(*(table.c[field] for field in dataset.record.model_fields))
                .where(table.c.owner_user_id == str(owner), table.c.id > (after or ""))
                .order_by(table.c.id)
                .limit(MAX_RECORDS + 1)
            )
        ).mappings()
        return [dataset.record.model_validate(row) for row in rows]
    model = dataset.model
    query = select(model).where(model.owner_user_id == str(owner))
    if model is VisualAssetFolder:
        values = list(await db.scalars(query))
        folders = {row.id: row for row in values}
        items = [
            (cursor, depth, identity)
            for cursor, depth, identity in ordered_folders(values)
            if cursor > (after or "")
        ][: MAX_RECORDS + 1]
        return [
            FolderRecord(
                **{key: getattr(folders[identity], key) for key in Record.model_fields},
                parent_id=folders[identity].parent_id,
                name=folders[identity].name,
                depth=depth,
                cursor=cursor,
            )
            for cursor, depth, identity in items
        ]
    values = await db.scalars(
        query.where(model.id > (after or "")).order_by(model.id).limit(MAX_RECORDS + 1)
    )
    return [dataset.record.model_validate(row, from_attributes=True) for row in values]


async def export_page(sessions, plan, dataset, owner, after, *, legacy=False):
    try:
        async with sessions(info={"owner_user_id": str(owner)}) as db:
            records = await page_records(db, owner, dataset, after, legacy=legacy)
    except ValidationError:
        raise invalid() from None
    batch = dataset.batch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset.name,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset.name}/{owner}/{after or ''}"),
        records=records[:MAX_RECORDS],
    )
    return dataset.page(
        batch=batch,
        sha256=batch.digest,
        next_cursor=getattr(batch.records[-1], dataset.key) if len(records) > MAX_RECORDS else None,
    )


async def validate_and_add(db, owner, dataset, records):
    folders = dataset.model is VisualAssetFolder
    local_depths = {}
    if folders and any(record.parent_id is not None for record in records):
        local_depths = {
            identity: depth
            for _cursor, depth, identity in ordered_folders(
                list(await db.scalars(select(VisualAssetFolder)))
            )
        }
    for record in records:
        parent_id = record.parent_id if folders else record.folder_id
        if parent_id:
            parent = await db.get(VisualAssetFolder, parent_id)
            if parent is None or parent.project_id != record.project_id:
                raise invalid("migration_folder_parent_conflict")
            if folders and local_depths.get(parent_id, -1) + 1 != record.depth:
                raise invalid("migration_folder_parent_conflict")
        if isinstance(record, ProjectLinkRecord):
            asset = await db.get(VisualAsset, record.asset_id)
            if asset is None or not is_library_asset(asset):
                raise invalid("migration_visual_link_asset_conflict")
        values = record.model_dump(exclude={"depth", "cursor"} if folders else None)
        db.add(dataset.model(owner_user_id=owner, **values))
        if folders:
            local_depths[record.id] = record.depth
            await db.flush()


async def import_batch(sessions, dataset, batch):
    owner = str(batch.owner_id)
    keys = [getattr(record, dataset.key) for record in batch.records]
    if keys != sorted(set(keys)):
        raise HTTPException(422, {"code": "migration_record_order_invalid"})
    receipt = BatchReceipt(
        run_id=batch.run_id,
        owner_id=batch.owner_id,
        batch_id=batch.batch_id,
        dataset=dataset.name,
        sha256=batch.digest,
        record_count=len(batch.records),
    )
    key = str(batch.run_id), dataset.name, owner, str(batch.batch_id)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        previous = await db.get(AssetImportReceipt, key)
        if previous is not None:
            if BatchReceipt.model_validate(previous.receipt) != receipt:
                raise invalid("migration_batch_conflict")
            return receipt
        try:
            await validate_and_add(db, owner, dataset, batch.records)
            db.add(
                AssetImportReceipt(
                    run_id=key[0],
                    dataset=key[1],
                    owner_user_id=key[2],
                    batch_id=key[3],
                    receipt=receipt.model_dump(mode="json"),
                )
            )
            await db.commit()
        except IntegrityError:
            raise invalid("migration_asset_overlap") from None
    return receipt
