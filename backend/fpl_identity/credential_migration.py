"""Identity-owned legacy accounts, browser sessions and Management API keys."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal
from uuid import uuid5

from argon2 import extract_parameters
from argon2.exceptions import InvalidHashError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, ValidationError, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import undefer

from app.capabilities.identity.passwords import normalize_username
from app.console.governance.profile import CONTENT_TYPES
from app.console.models.accounts import AuthSession, ManagementApiKey, User
from fpl_runtime.migration_batches import (
    MAX_RECORDS,
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)

from .models import IdentityImportReceipt

UUID_PATTERN = r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class IdentityRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str = Field(pattern=UUID_PATTERN)
    created_at: datetime


class AccountRecord(IdentityRecord):
    username: str = Field(max_length=64)
    username_normalized: str = Field(max_length=64)
    display_name: str = Field(max_length=120)
    email: str | None = Field(max_length=254)
    email_normalized: str | None = Field(max_length=254)
    avatar_relative_path: str = Field(max_length=512)
    avatar_content_type: str = Field(max_length=64)
    avatar_content_sha256: Digest | Literal[""]
    password_hash: str = Field(max_length=512, repr=False)
    status: Literal["active", "disabled"]
    is_platform_admin: bool
    platform_role: Literal["admin", "user"]
    must_change_password: bool
    revision: int = Field(ge=0)
    last_login_at: datetime | None
    updated_at: datetime

    @model_validator(mode="after")
    def verify_account(self):
        if normalize_username(self.username) != self.username_normalized:
            raise ValueError("账号名称索引不一致")
        if (self.email.casefold() if self.email else None) != self.email_normalized:
            raise ValueError("账号邮件索引不一致")
        if self.is_platform_admin != (self.platform_role == "admin"):
            raise ValueError("管理员标记与账号角色不一致")
        if self.avatar_relative_path:
            suffix = CONTENT_TYPES.get(self.avatar_content_type)
            expected = f"{self.id}/{self.avatar_content_sha256}{suffix}"
            if (
                suffix is None
                or not self.avatar_content_sha256
                or self.avatar_relative_path != expected
            ):
                raise ValueError("头像归属路径或摘要无效")
        try:
            extract_parameters(self.password_hash)
        except (InvalidHashError, ValueError):
            raise ValueError("账号密码摘要无效") from None
        return self


class SessionRecord(IdentityRecord):
    purpose: Literal["studio"]
    token_hash: Digest = Field(repr=False)
    csrf_hash: Digest = Field(repr=False)
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    reauthenticated_at: datetime
    revoked_at: datetime | None
    client_ip: str = Field(max_length=64)
    user_agent: str = Field(max_length=500)


class KeyRecord(IdentityRecord):
    name: str = Field(max_length=64)
    key_hash: Digest = Field(repr=False)
    key_prefix: str = Field(max_length=16)
    scopes: list[str] = Field(max_length=32)
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revision: int = Field(ge=0)
    updated_at: datetime


class Accounts(MigrationBatch[AccountRecord]):
    dataset: Literal["identity.accounts"]


class Sessions(MigrationBatch[SessionRecord]):
    dataset: Literal["identity.sessions"]


class Keys(MigrationBatch[KeyRecord]):
    dataset: Literal["identity.api-keys"]


@dataclass(frozen=True)
class CredentialDataset:
    path: str
    model: type[User] | type[AuthSession] | type[ManagementApiKey]
    record: type[IdentityRecord]
    batch: type[MigrationBatch]
    page: type[MigrationPage]

    @property
    def name(self):
        return f"identity.{self.path}"

    @property
    def owner_column(self):
        return User.id if self.model is User else self.model.user_id


DATASETS = (
    CredentialDataset("accounts", User, AccountRecord, Accounts, MigrationPage[Accounts]),
    CredentialDataset("sessions", AuthSession, SessionRecord, Sessions, MigrationPage[Sessions]),
    CredentialDataset("api-keys", ManagementApiKey, KeyRecord, Keys, MigrationPage[Keys]),
)


def _serialize(dataset, row, *, legacy):
    try:
        if legacy and dataset.model is AuthSession:
            # The legacy database has only Studio sessions and no purpose column.
            return SessionRecord.model_validate(
                {
                    field: getattr(row, field) if field != "purpose" else "studio"
                    for field in SessionRecord.model_fields
                }
            )
        return dataset.record.model_validate(row, from_attributes=True)
    except ValidationError:
        raise HTTPException(409, {"code": "migration_identity_record_invalid"}) from None


async def inventory(sessions, plan, dataset, *, legacy):
    owner = dataset.owner_column
    async with sessions() as session:
        rows = await session.execute(select(owner, func.count()).group_by(owner))
        counts = dict(rows.all())
    allowed = {str(account) for account in plan.owner_ids}
    if set(counts) - allowed or (legacy and dataset.model is User and set(counts) != allowed):
        raise HTTPException(409, {"code": "migration_owner_unassigned"})
    return {"record_count": sum(counts.values())}


async def export_page(sessions, plan, dataset, owner, after, *, legacy):
    model = dataset.model
    query = (
        select(model)
        .where(dataset.owner_column == str(owner), model.id > (after or ""))
        .order_by(model.id)
        .limit(MAX_RECORDS + 1)
    )
    if model is AuthSession and not legacy:
        query = query.options(undefer(AuthSession.purpose))
    async with sessions() as session:
        rows = list(await session.scalars(query))
        records = tuple(_serialize(dataset, row, legacy=legacy) for row in rows[:MAX_RECORDS])
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
        next_cursor=records[-1].id if len(rows) > MAX_RECORDS else None,
    )


async def import_batch(database, dataset, batch):
    owner = str(batch.owner_id)
    model = dataset.model
    ids = [record.id for record in batch.records]
    if ids != sorted(set(ids)) or (model is User and ids != [owner]):
        raise HTTPException(422, {"code": "migration_identity_record_order_or_owner"})
    digest = batch.digest
    key = str(batch.run_id), dataset.name, owner, str(batch.batch_id)
    async with database.sessions() as session:
        await session.execute(text("BEGIN IMMEDIATE"))
        previous = await session.get(IdentityImportReceipt, key)
        if previous is not None:
            receipt = BatchReceipt.model_validate(previous.receipt)
            if receipt.sha256 != digest:
                raise HTTPException(409, {"code": "migration_batch_conflict"})
            return receipt
        if model is not User and await session.get(User, owner) is None:
            raise HTTPException(409, {"code": "migration_owner_missing"})
        if ids and await session.scalar(select(model.id).where(model.id.in_(ids)).limit(1)):
            raise HTTPException(409, {"code": "migration_identity_overlap"})
        owned = {} if model is User else {"user_id": owner}
        session.add_all([model(**owned, **record.model_dump()) for record in batch.records])
        receipt = BatchReceipt(
            run_id=batch.run_id,
            owner_id=batch.owner_id,
            batch_id=batch.batch_id,
            dataset=dataset.name,
            sha256=digest,
            record_count=len(ids),
        )
        session.add(
            IdentityImportReceipt(
                run_id=key[0],
                dataset=key[1],
                owner_user_id=owner,
                batch_id=key[3],
                receipt=receipt.model_dump(mode="json"),
            )
        )
        try:
            await session.commit()
        except IntegrityError:
            raise HTTPException(409, {"code": "migration_identity_conflict"}) from None
    return receipt
