"""Rebuild Motion and Video project file scopes after the originals were transferred."""

import hashlib
import json
from functools import partial
from typing import Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, model_validator
from sqlalchemy import column, func, or_, select, table, text
from sqlalchemy.exc import IntegrityError

from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.service_models import AssetReferenceSet
from studio.contracts.asset_library.descriptions import ID
from studio.contracts.management.migration_batches import MAX_RECORDS, MigrationBatch, MigrationPage
from studio.runtime.database.migration_apps import mount_dataset
from studio.runtime.database.migration_receipts import batch_receipt, has_receipt, record_receipt

from .migration_models import AssetImportReceipt

DATASET = "assets.editing-project-scopes"
PREFIX = "/v1/migration/assets/editing-project-scopes"
CURSOR = rf"^(?:motion|video):{ID}$"
SOURCE_TABLES = {
    "motion": table(
        "motion_compositor_projects", column("id"), column("owner_user_id"), column("revision")
    ),
    "video": table(
        "video_editor_projects", column("id"), column("owner_user_id"), column("revision")
    ),
}
FILE_SCOPE = {
    "motion": VisualAsset.motion_compositor_project_id,
    "video": VisualAsset.video_editor_project_id,
}


class ProjectScopeRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=CURSOR)
    service: Literal["motion", "video"]
    project_id: str = Field(pattern=f"^{ID}$")
    revision: int = Field(ge=0, strict=True)
    file_count: int = Field(ge=0, strict=True)
    file_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def verify_cursor(self):
        if self.id != f"{self.service}:{self.project_id}":
            raise ValueError("素材范围游标与项目不符")
        return self


class ProjectScopeBatch(MigrationBatch[ProjectScopeRecord]):
    dataset: Literal["assets.editing-project-scopes"]


ProjectScopePage = MigrationPage[ProjectScopeBatch]


def blocked(code):
    return HTTPException(409, {"code": code})


async def file_set(session, owner, service, project):
    query = (
        select(VisualAsset.id, VisualAsset.revision, VisualAsset.byte_size)
        .where(VisualAsset.owner_user_id == owner, FILE_SCOPE[service] == project)
        .order_by(VisualAsset.id)
    )
    digest, count = hashlib.sha256(), 0
    async for row in await session.stream(query):
        count += 1
        digest.update(json.dumps(tuple(row), separators=(",", ":")).encode() + b"\n")
    return count, digest.hexdigest()


def target_scope(service):
    return (
        AssetReferenceSet.service_id == service,
        AssetReferenceSet.resource_kind == "project",
        AssetReferenceSet.deleted.is_(False),
    )


async def inventory(sessions, plan, legacy):
    owners = {str(owner) for owner in plan.owner_ids}
    total = 0
    async with sessions(info={"allow_system_reads": True}) as session:
        for service, source in SOURCE_TABLES.items():
            if legacy:
                scope = FILE_SCOPE[service]
                conflict = await session.scalar(
                    select(func.count())
                    .select_from(VisualAsset)
                    .outerjoin(source, source.c.id == scope)
                    .where(
                        scope.is_not(None),
                        or_(
                            source.c.id.is_(None),
                            VisualAsset.owner_user_id != source.c.owner_user_id,
                        ),
                    )
                )
                if conflict:
                    raise blocked("migration_editing_file_owner_conflict")
                query = select(source.c.owner_user_id, func.count()).group_by(
                    source.c.owner_user_id
                )
            else:
                query = (
                    select(AssetReferenceSet.owner_user_id, func.count())
                    .where(*target_scope(service))
                    .group_by(AssetReferenceSet.owner_user_id)
                )
            counts = dict((await session.execute(query)).all())
            if set(counts) - owners:
                raise blocked("migration_owner_unassigned")
            total += sum(counts.values())
    return {"record_count": total}


async def page(sessions, plan, legacy, owner_id, after):
    owner = str(owner_id)
    after_service, _, after_id = (after or "").partition(":")
    records = []
    async with sessions(info={"owner_user_id": owner}) as session:
        for service, source in SOURCE_TABLES.items():
            if service < after_service or len(records) > MAX_RECORDS:
                continue
            lower = after_id if service == after_service else ""
            if legacy:
                query = (
                    select(source.c.id, source.c.revision)
                    .where(source.c.owner_user_id == owner, source.c.id > lower)
                    .order_by(source.c.id)
                )
            else:
                query = (
                    select(AssetReferenceSet.resource_id, AssetReferenceSet.resource_revision)
                    .where(
                        *target_scope(service),
                        AssetReferenceSet.owner_user_id == owner,
                        AssetReferenceSet.resource_id > lower,
                    )
                    .order_by(AssetReferenceSet.resource_id)
                )
            for project, revision in (await session.execute(query.limit(MAX_RECORDS + 1))).all():
                count, digest = await file_set(session, owner, service, project)
                records.append(
                    ProjectScopeRecord(
                        id=f"{service}:{project}",
                        service=service,
                        project_id=project,
                        revision=revision,
                        file_count=count,
                        file_sha256=digest,
                    )
                )
                if len(records) > MAX_RECORDS:
                    break
    batch = ProjectScopeBatch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=DATASET,
        owner_id=owner_id,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{after or ''}"),
        records=records[:MAX_RECORDS],
    )
    return ProjectScopePage(
        batch=batch,
        sha256=batch.digest,
        next_cursor=batch.records[-1].id if len(records) > MAX_RECORDS else None,
    )


async def ingest(sessions, batch):
    owner = str(batch.owner_id)
    ids = [record.id for record in batch.records]
    if ids != sorted(set(ids)):
        raise HTTPException(422, {"code": "migration_record_order_invalid"})
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        if await has_receipt(session, AssetImportReceipt, receipt):
            return receipt
        for record in batch.records:
            current = await file_set(session, owner, record.service, record.project_id)
            if current != (record.file_count, record.file_sha256):
                raise blocked("migration_editing_files_incomplete")
            session.add(
                AssetReferenceSet(
                    owner_user_id=owner,
                    service_id=record.service,
                    resource_kind="project",
                    resource_id=record.project_id,
                    resource_revision=record.revision,
                )
            )
        record_receipt(session, AssetImportReceipt, receipt)
        try:
            await session.commit()
        except IntegrityError:
            raise blocked("migration_editing_project_scope_overlap") from None
    return receipt


def mount_project_scopes(app, plan, sessions, *, source=None):
    mount_dataset(
        app,
        prefix=PREFIX,
        plan=plan,
        cursor_pattern=CURSOR,
        batch_model=ProjectScopeBatch,
        page_model=ProjectScopePage,
        inventory=partial(inventory, sessions, plan, source is not None),
        page=partial(page, sessions, plan, source is not None),
        ingest=partial(ingest, sessions) if source is None else None,
        source=source,
    )
