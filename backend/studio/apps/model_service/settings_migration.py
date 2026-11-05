"""Map legacy platform setting partitions into the Models-owned tables."""

from dataclasses import dataclass
from datetime import datetime
from typing import Literal
from uuid import uuid5

from cryptography.fernet import InvalidToken
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError
from sqlalchemy import JSON, Column, DateTime, Integer, MetaData, String, Table, select, text
from sqlalchemy.exc import IntegrityError

from app.demo_runtime.engine import SERVICE_IDS
from app.demo_runtime.schemas import DemoConfig
from app.llm.models import ModelEntry
from studio.apps.model_service.storage.service_models import (
    AccountDefaults,
    DemoSetting,
    QuotaPolicy,
    RoleTemplate,
)
from studio.contracts.management.migration_batches import (
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)
from studio.contracts.model_service.schemas.model_service import ModelDefaultsIn
from studio.contracts.model_service.schemas.model_templates import RoleModelTemplate
from studio.contracts.model_service.schemas.runtime_quotas import RuntimeQuotas

from .catalog_migration import ModelsImportReceipt, conflict

DEFAULT_PREFIX = "account_defaults:"
DEFAULTS = "models.account-defaults"
POLICY = "models.policy"
LEGACY = Table(
    "platform_settings",
    MetaData(),
    Column("id", String(100), primary_key=True),
    Column("payload", JSON),
    Column("revision", Integer),
    Column("created_at", DateTime),
    Column("updated_at", DateTime),
)
POLICIES = {
    "runtime_quotas": (QuotaPolicy, "id", "runtime", RuntimeQuotas),
    **{
        f"role_template:{role}": (RoleTemplate, "role", role, RoleModelTemplate)
        for role in ("admin", "user")
    },
    **{
        f"demo_service:{service}": (DemoSetting, "id", service, DemoConfig)
        for service in SERVICE_IDS
    },
}
CURSOR = r"^[a-z0-9_:-]{1,100}$"


class Setting(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    key: str = Field(pattern=CURSOR)
    payload: dict[str, JsonValue] = Field(repr=False)
    revision: int = Field(ge=0, strict=True)
    created_at: datetime
    updated_at: datetime


class AccountSettings(MigrationBatch[Setting]):
    dataset: Literal["models.account-defaults"]
    records: tuple[Setting, ...] = Field(max_length=1)


class PlatformSettings(MigrationBatch[Setting]):
    dataset: Literal["models.policy"]
    records: tuple[Setting, ...] = Field(max_length=len(POLICIES))


@dataclass(frozen=True)
class SettingsDataset:
    name: str
    batch: type[MigrationBatch]
    page: type[MigrationPage]
    platform: bool


SETTINGS = (
    SettingsDataset(DEFAULTS, AccountSettings, MigrationPage[AccountSettings], False),
    SettingsDataset(POLICY, PlatformSettings, MigrationPage[PlatformSettings], True),
)
MODELS = (AccountDefaults, QuotaPolicy, RoleTemplate, DemoSetting)


def read_setting(key, row, payload):
    return Setting(
        key=key,
        payload=payload,
        revision=row.revision,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def legacy_query(dataset, owner):
    if dataset.platform:
        return select(LEGACY).where(LEGACY.c.id.in_(POLICIES)).order_by(LEGACY.c.id)
    return select(LEGACY).where(LEGACY.c.id == DEFAULT_PREFIX + str(owner))


async def inventory(sessions, plan, dataset, *, legacy):
    async with sessions(info={"allow_system_reads": True}) as db:
        if legacy:
            if dataset.platform:
                keys = list(await db.scalars(select(LEGACY.c.id).where(LEGACY.c.id.in_(POLICIES))))
            else:
                keys = list(
                    await db.scalars(
                        select(LEGACY.c.id).where(
                            LEGACY.c.id.startswith(DEFAULT_PREFIX, autoescape=True)
                        )
                    )
                )
        elif dataset.platform:
            keys = []
            for key, (model, _column, identifier, _schema) in POLICIES.items():
                if await db.get(model, identifier) is not None:
                    keys.append(key)
        else:
            keys = [
                DEFAULT_PREFIX + owner
                for owner in await db.scalars(select(AccountDefaults.owner_user_id))
            ]
    if not dataset.platform and set(keys) - {
        DEFAULT_PREFIX + str(owner) for owner in plan.owner_ids
    }:
        raise conflict("migration_owner_unassigned")
    return {"record_count": len(keys)}


async def export_page(sessions, plan, dataset, owner, after, *, legacy):
    records = []
    try:
        async with sessions(info={"owner_user_id": str(owner)}) as db:
            if after is None and legacy:
                records = [
                    read_setting(row.id, row, row.payload)
                    for row in (await db.execute(legacy_query(dataset, owner))).all()
                ]
            elif after is None and dataset.platform:
                for key, (model, _column, identifier, _schema) in sorted(POLICIES.items()):
                    row = await db.get(model, identifier)
                    if row is not None:
                        records.append(read_setting(key, row, row.payload))
            elif after is None:
                row = await db.get(AccountDefaults, str(owner))
                if row is not None:
                    records.append(read_setting(DEFAULT_PREFIX + str(owner), row, row.model_ids))
    except ValidationError:
        raise conflict("migration_model_setting_invalid") from None
    batch = dataset.batch(
        run_id=plan.run_id,
        source_revision=plan.source_revision,
        source_database_sha256=plan.source_database_sha256,
        dataset=dataset.name,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{dataset.name}/{owner}/{after or ''}"),
        records=records,
    )
    return dataset.page(batch=batch, sha256=batch.digest, next_cursor=None)


async def account_defaults(db, owner, item):
    if item.key != DEFAULT_PREFIX + owner:
        raise conflict("migration_owner_unassigned")
    values = ModelDefaultsIn(expected_revision=0, default_model_ids=item.payload).default_model_ids
    if values:
        records = await db.scalars(
            select(ModelEntry).where(ModelEntry.id.in_(set(values.values())))
        )
        by_id = {row.id: row for row in records}
        if any(
            identity not in by_id or purpose not in by_id[identity].capabilities
            for purpose, identity in values.items()
        ):
            raise conflict("migration_model_relation_unassigned")
    return AccountDefaults(owner_user_id=owner, model_ids=item.payload)


def platform_policy(cipher, item):
    definition = POLICIES.get(item.key)
    if definition is None:
        raise conflict("migration_model_policy_unassigned")
    model, key_column, identifier, schema = definition
    schema.model_validate(item.payload)
    if model is RoleTemplate:
        for provider in item.payload.get("providers", []):
            if provider.get("api_key") or provider.get("clear_api_key"):
                raise conflict("migration_model_policy_invalid")
            ciphertext = provider.get("api_key_ciphertext", "")
            if ciphertext:
                if not isinstance(ciphertext, str):
                    raise conflict("migration_model_credential_unreadable")
                cipher.decrypt(ciphertext)
    return model(**{key_column: identifier}, payload=item.payload)


async def import_batch(sessions, dataset, cipher, batch):
    keys = [item.key for item in batch.records]
    if keys != sorted(set(keys)):
        raise HTTPException(422, {"code": "migration_model_record_order_or_owner"})
    owner = str(batch.owner_id)
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
        try:
            for item in batch.records:
                row = (
                    platform_policy(cipher, item)
                    if dataset.platform
                    else await account_defaults(db, owner, item)
                )
                row.revision, row.created_at, row.updated_at = (
                    item.revision,
                    item.created_at,
                    item.updated_at,
                )
                db.add(row)
        except ValidationError:
            raise conflict("migration_model_policy_invalid") from None
        except (InvalidToken, UnicodeError, ValueError):
            raise conflict("migration_model_credential_unreadable") from None
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
            raise conflict("migration_model_policy_overlap") from None
    return receipt
