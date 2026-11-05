"""Preserve Models catalog identities, relationships and encrypted credentials."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal
from uuid import uuid5

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import JSON, String, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Mapped, mapped_column

from studio.apps.model_service.storage.models.model_service import (
    ModelCatalogState,
    ModelEntry,
    ModelProvider,
)
from studio.apps.model_service.storage.models.model_supplier import ModelSupplier
from studio.contracts.management.migration_batches import (
    MAX_RECORDS,
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)

from .orm import ModelsBase

UUID_PATTERN = r"^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$"
OwnedId = Annotated[str, Field(pattern=UUID_PATTERN)]


class ModelsImportReceipt(ModelsBase):
    __tablename__ = "models_import_receipts"

    run_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    dataset: Mapped[str] = mapped_column(String(64), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    batch_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    receipt: Mapped[dict] = mapped_column(JSON)


class CatalogRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: OwnedId
    origin: str = Field(max_length=24)
    sort_order: int
    created_at: datetime
    updated_at: datetime


class SupplierRecord(CatalogRecord):
    name: str = Field(max_length=120)
    template_key: str | None = Field(max_length=160)


class ProviderRecord(CatalogRecord):
    name: str = Field(max_length=120)
    template_key: str | None = Field(max_length=100)
    supplier_id: OwnedId | None
    kind: str = Field(max_length=24)
    base_url: str = Field(max_length=512)
    api_key_ciphertext: str = Field(max_length=65536, repr=False)
    enabled: bool


class EntryRecord(CatalogRecord):
    provider_id: OwnedId
    template_key: str | None = Field(max_length=100)
    slug: str = Field(max_length=160)
    label: str = Field(max_length=160)
    description: str = Field(max_length=255)
    capabilities: list[str]
    categories: list[str]
    enabled: bool


class CatalogStateRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    owner_user_id: OwnedId
    revision: int = Field(ge=0, strict=True)
    updated_at: datetime


class Suppliers(MigrationBatch[SupplierRecord]):
    dataset: Literal["models.suppliers"]


class Providers(MigrationBatch[ProviderRecord]):
    dataset: Literal["models.providers"]


class Entries(MigrationBatch[EntryRecord]):
    dataset: Literal["models.entries"]


class CatalogStates(MigrationBatch[CatalogStateRecord]):
    dataset: Literal["models.catalog-state"]


@dataclass(frozen=True)
class CatalogDataset:
    name: str
    model: type
    record: type[BaseModel]
    batch: type[MigrationBatch]
    page: type[MigrationPage]
    key: str = "id"
    relation: tuple[str, type] | None = None

    @property
    def key_column(self):
        return getattr(self.model, self.key)


DATASETS = (
    CatalogDataset(
        "models.suppliers", ModelSupplier, SupplierRecord, Suppliers, MigrationPage[Suppliers]
    ),
    CatalogDataset(
        "models.providers",
        ModelProvider,
        ProviderRecord,
        Providers,
        MigrationPage[Providers],
        relation=("supplier_id", ModelSupplier),
    ),
    CatalogDataset(
        "models.entries",
        ModelEntry,
        EntryRecord,
        Entries,
        MigrationPage[Entries],
        relation=("provider_id", ModelProvider),
    ),
    CatalogDataset(
        "models.catalog-state",
        ModelCatalogState,
        CatalogStateRecord,
        CatalogStates,
        MigrationPage[CatalogStates],
        key="owner_user_id",
    ),
)


def conflict(code):
    return HTTPException(409, {"code": code})


async def inventory(sessions, plan, dataset):
    owner = dataset.model.owner_user_id
    async with sessions(info={"allow_system_reads": True}) as db:
        counts = dict((await db.execute(select(owner, func.count()).group_by(owner))).all())
    if set(counts) - {str(value) for value in plan.owner_ids}:
        raise conflict("migration_owner_unassigned")
    return {"record_count": sum(counts.values())}


async def export_page(sessions, plan, dataset, owner, after):
    async with sessions(info={"owner_user_id": str(owner)}) as db:
        rows = list(
            await db.scalars(
                select(dataset.model)
                .where(
                    dataset.model.owner_user_id == str(owner), dataset.key_column > (after or "")
                )
                .order_by(dataset.key_column)
                .limit(MAX_RECORDS + 1)
            )
        )
    try:
        records = [
            dataset.record.model_validate(row, from_attributes=True) for row in rows[:MAX_RECORDS]
        ]
    except ValidationError:
        raise conflict("migration_model_catalog_invalid") from None
    batch = dataset.batch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset.name,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset.name}/{owner}/{after or ''}"),
        records=records,
    )
    return dataset.page(
        batch=batch,
        sha256=batch.digest,
        next_cursor=getattr(records[-1], dataset.key) if len(rows) > MAX_RECORDS else None,
    )


async def validate_relations(db, dataset, records):
    if dataset.relation is None:
        return
    field, model = dataset.relation
    references = {getattr(row, field) for row in records} - {None}
    if references:
        resolved = set(await db.scalars(select(model.id).where(model.id.in_(references))))
        if resolved != references:
            raise conflict("migration_model_relation_unassigned")


def verify_ciphertext(cipher, records):
    try:
        for record in records:
            if record.api_key_ciphertext:
                cipher.decrypt(record.api_key_ciphertext)
    except (InvalidToken, UnicodeError, ValueError):
        raise conflict("migration_model_credential_unreadable") from None


async def import_batch(sessions, dataset, cipher, batch):
    owner = str(batch.owner_id)
    keys = [getattr(record, dataset.key) for record in batch.records]
    if keys != sorted(set(keys)) or (dataset.key == "owner_user_id" and keys not in ([], [owner])):
        raise HTTPException(422, {"code": "migration_model_record_order_or_owner"})
    if dataset.model is ModelProvider:
        verify_ciphertext(cipher, batch.records)
    receipt = BatchReceipt(
        run_id=batch.run_id,
        owner_id=batch.owner_id,
        batch_id=batch.batch_id,
        dataset=dataset.name,
        sha256=batch.digest,
        record_count=len(keys),
    )
    key = str(batch.run_id), dataset.name, owner, str(batch.batch_id)
    async with sessions(info={"owner_user_id": owner}) as db:
        await db.execute(text("BEGIN IMMEDIATE"))
        previous = await db.get(ModelsImportReceipt, key)
        if previous is not None:
            if BatchReceipt.model_validate(previous.receipt) != receipt:
                raise conflict("migration_batch_conflict")
            return receipt
        await validate_relations(db, dataset, batch.records)
        owned = {} if dataset.key == "owner_user_id" else {"owner_user_id": owner}
        db.add_all([dataset.model(**owned, **row.model_dump()) for row in batch.records])
        db.add(
            ModelsImportReceipt(
                run_id=key[0],
                dataset=key[1],
                owner_user_id=key[2],
                batch_id=key[3],
                receipt=receipt.model_dump(mode="json"),
            )
        )
        try:
            await db.commit()
        except IntegrityError:
            raise conflict("migration_model_catalog_overlap") from None
    return receipt
