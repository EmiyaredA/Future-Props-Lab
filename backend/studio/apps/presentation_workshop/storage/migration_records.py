"""Move owned historical documents and templates without changing their JSON or revisions."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid5

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError

from studio.apps.presentation_workshop.schemas.document import PresentationDocument
from studio.apps.presentation_workshop.storage.models import PresentationProject
from studio.apps.presentation_workshop.storage.service_models import PresentationMigrationReceipt
from studio.apps.presentation_workshop.templates.models import (
    PresentationExample,
    PresentationTemplate,
)
from studio.apps.presentation_workshop.templates.schema import TemplateDefinition
from studio.contracts.management.migration_batches import MigrationBatch, MigrationPage
from studio.contracts.presentation_workshop.presentation_migration import ID
from studio.runtime.database.migration_receipts import batch_receipt, has_receipt, record_receipt


class RootRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=ID)
    title: str = Field(min_length=1, max_length=120)
    revision: int = Field(ge=0)
    created_at: datetime
    updated_at: datetime


class ProjectRecord(RootRecord):
    document: dict

    @field_validator("document")
    @classmethod
    def valid_document(cls, value):
        PresentationDocument.model_validate(value)
        return value


class ExampleRecord(ProjectRecord):
    description: str = Field(max_length=1000)


class TemplateRecord(RootRecord):
    description: str = Field(max_length=1000)
    definition: dict

    @field_validator("definition")
    @classmethod
    def valid_definition(cls, value):
        TemplateDefinition.model_validate(value)
        return value


class Projects(MigrationBatch[ProjectRecord]):
    dataset: Literal["presentation.projects"]
    records: tuple[ProjectRecord, ...] = Field(max_length=1)


class Templates(MigrationBatch[TemplateRecord]):
    dataset: Literal["presentation.templates"]
    records: tuple[TemplateRecord, ...] = Field(max_length=1)


class Examples(MigrationBatch[ExampleRecord]):
    dataset: Literal["presentation.examples"]
    records: tuple[ExampleRecord, ...] = Field(max_length=1)


@dataclass(frozen=True)
class Dataset:
    name: str
    model: type
    record: type
    batch: type
    page: type


DATASETS = (
    Dataset(
        "presentation.projects",
        PresentationProject,
        ProjectRecord,
        Projects,
        MigrationPage[Projects],
    ),
    Dataset(
        "presentation.templates",
        PresentationTemplate,
        TemplateRecord,
        Templates,
        MigrationPage[Templates],
    ),
    Dataset(
        "presentation.examples",
        PresentationExample,
        ExampleRecord,
        Examples,
        MigrationPage[Examples],
    ),
)


async def inventory(sessions, plan, model):
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict(
            (
                await db.execute(
                    select(model.owner_user_id, func.count()).group_by(model.owner_user_id)
                )
            ).all()
        )
    if set(counts) - {str(owner) for owner in plan.owner_ids}:
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def list_rows(db, model, owner, after):
    return list(
        await db.scalars(
            select(model)
            .where(model.owner_user_id == str(owner), model.id > (after or ""))
            .order_by(model.id)
            .limit(2)
        )
    )


def page_for(plan, owner, after, *, dataset, batch_type, page_type, records, more):
    batch = batch_type(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset}/{owner}/{after or ''}"),
        records=records,
    )
    return page_type(batch=batch, sha256=batch.digest, next_cursor=records[-1].id if more else None)


async def export_page(sessions, plan, dataset, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = await list_rows(db, dataset.model, owner, after)
    try:
        records = tuple(
            dataset.record.model_validate(row, from_attributes=True) for row in rows[:1]
        )
    except ValidationError:
        raise HTTPException(409, {"code": "migration_presentation_record_invalid"}) from None
    return page_for(
        plan,
        owner,
        after,
        dataset=dataset.name,
        batch_type=dataset.batch,
        page_type=dataset.page,
        records=records,
        more=len(rows) > 1,
    )


async def import_batch(sessions, dataset, batch):
    owner = str(batch.owner_id)
    receipt = batch_receipt(batch)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        if not await has_receipt(db, PresentationMigrationReceipt, receipt):
            db.add_all(
                dataset.model(owner_user_id=owner, **row.model_dump()) for row in batch.records
            )
            record_receipt(db, PresentationMigrationReceipt, receipt)
            try:
                await db.commit()
            except IntegrityError:
                raise HTTPException(409, {"code": "migration_presentation_overlap"}) from None
    return receipt
