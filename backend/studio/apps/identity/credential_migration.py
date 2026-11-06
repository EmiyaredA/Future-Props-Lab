"""Identity-owned legacy accounts, credentials and cloud verification history."""

from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Literal
from uuid import uuid5

from argon2 import extract_parameters
from argon2.exceptions import InvalidHashError
from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field, JsonValue, ValidationError, model_validator
from sqlalchemy import func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import undefer

from studio.apps.identity.storage.models.accounts import (
    AuthSession,
    ManagementApiKey,
    SecurityAuditEvent,
    User,
)
from studio.apps.identity.storage.models.cloud import CloudFactor, CloudUnlock
from studio.apps.identity.storage.models.registration import (
    RegistrationInviteCode,
    RegistrationRedemption,
)
from studio.apps.identity.storage.service_models import IdentityImportReceipt
from studio.contracts.identity.usernames import normalize_username
from studio.contracts.management.migration_batches import (
    MAX_RECORDS,
    BatchReceipt,
    MigrationBatch,
    MigrationPage,
)

from .avatar_files import DIGEST_PATTERN, avatar_filename

UUID_PATTERN = r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"
Digest = Annotated[str, Field(pattern=DIGEST_PATTERN)]


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
        avatar_filename(
            self.id, self.avatar_relative_path, self.avatar_content_type, self.avatar_content_sha256
        )
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
    secret_ciphertext: str | None = Field(
        default=None,
        min_length=1,
        max_length=1024,
        repr=False,
        exclude_if=lambda value: value is None,
    )
    key_prefix: str = Field(max_length=16)
    scopes: list[str] = Field(max_length=32)
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revision: int = Field(ge=0)
    updated_at: datetime


class FactorRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    owner_user_id: str = Field(pattern=UUID_PATTERN)
    secret: str | None = Field(min_length=1, max_length=1024, repr=False)
    pending_secret: str | None = Field(min_length=1, max_length=1024, repr=False)
    pending_until: int = Field(ge=0)
    last_counter: int = Field(ge=-1)
    attempts: int = Field(ge=0)
    attempt_window: int = Field(ge=0)


class UnlockRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    session_id: str = Field(pattern=UUID_PATTERN)
    expires_at: int = Field(ge=0)
    ticket_hash: Digest | None = Field(repr=False)
    ticket_until: int = Field(ge=0)
    desktop_verified: bool


class InviteRecord(IdentityRecord):
    name: str = Field(min_length=1, max_length=120)
    code_hash: Digest = Field(repr=False)
    code_hint: str = Field(max_length=40)
    secret_ciphertext: str = Field(min_length=1, max_length=1024, repr=False)
    enabled: bool
    max_uses: int = Field(ge=1, le=10000)
    used_count: int = Field(ge=0)
    validity_days: int = Field(ge=1, le=365)
    expires_at: datetime
    deleted_at: datetime | None
    revision: int = Field(ge=0)
    updated_at: datetime

    @model_validator(mode="after")
    def verify_invite(self):
        if self.used_count > self.max_uses or (self.deleted_at is not None and self.enabled):
            raise ValueError("邀请码状态不一致")
        return self


class RedemptionRecord(IdentityRecord):
    invite_id: str = Field(pattern=UUID_PATTERN)


class AuditRecord(IdentityRecord):
    actor_user_id: Annotated[str, Field(pattern=UUID_PATTERN)] | None
    target_user_id: Annotated[str, Field(pattern=UUID_PATTERN)] | None
    owner_user_id: Annotated[str, Field(pattern=UUID_PATTERN)] | None
    event_type: str = Field(min_length=1, max_length=64)
    outcome: str = Field(min_length=1, max_length=16)
    client_ip: str = Field(max_length=64)
    user_agent: str = Field(max_length=500)
    metadata_json: dict[str, JsonValue] = Field(repr=False)


class Accounts(MigrationBatch[AccountRecord]):
    dataset: Literal["identity.accounts"]


class Sessions(MigrationBatch[SessionRecord]):
    dataset: Literal["identity.sessions"]


class Keys(MigrationBatch[KeyRecord]):
    dataset: Literal["identity.api-keys"]


class Factors(MigrationBatch[FactorRecord]):
    dataset: Literal["identity.cloud-factors"]


class Unlocks(MigrationBatch[UnlockRecord]):
    dataset: Literal["identity.cloud-unlocks"]


class Invites(MigrationBatch[InviteRecord]):
    dataset: Literal["identity.registration-invites"]


class Redemptions(MigrationBatch[RedemptionRecord]):
    dataset: Literal["identity.registration-redemptions"]


class Audit(MigrationBatch[AuditRecord]):
    dataset: Literal["identity.security-audit"]


@dataclass(frozen=True)
class CredentialDataset:
    path: str
    model: type
    record: type[BaseModel]
    batch: type[MigrationBatch]
    page: type[MigrationPage]
    key_field: str = "id"
    owner_field: str | None = "user_id"

    @property
    def platform(self):
        return self.owner_field is None

    @property
    def name(self):
        return f"identity.{self.path}"

    @property
    def owner_column(self):
        return getattr(self.model, self.owner_field)

    @property
    def key_column(self):
        return getattr(self.model, self.key_field)


DATASETS = (
    CredentialDataset(
        "accounts", User, AccountRecord, Accounts, MigrationPage[Accounts], owner_field="id"
    ),
    CredentialDataset("sessions", AuthSession, SessionRecord, Sessions, MigrationPage[Sessions]),
    CredentialDataset("api-keys", ManagementApiKey, KeyRecord, Keys, MigrationPage[Keys]),
    CredentialDataset(
        "cloud-factors",
        CloudFactor,
        FactorRecord,
        Factors,
        MigrationPage[Factors],
        key_field="owner_user_id",
        owner_field="owner_user_id",
    ),
    CredentialDataset(
        "cloud-unlocks",
        CloudUnlock,
        UnlockRecord,
        Unlocks,
        MigrationPage[Unlocks],
        key_field="session_id",
        owner_field="owner_user_id",
    ),
    CredentialDataset(
        "registration-invites",
        RegistrationInviteCode,
        InviteRecord,
        Invites,
        MigrationPage[Invites],
        owner_field=None,
    ),
    CredentialDataset(
        "registration-redemptions",
        RegistrationRedemption,
        RedemptionRecord,
        Redemptions,
        MigrationPage[Redemptions],
    ),
    CredentialDataset(
        "security-audit",
        SecurityAuditEvent,
        AuditRecord,
        Audit,
        MigrationPage[Audit],
        owner_field=None,
    ),
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
    async with sessions() as session:
        if dataset.platform:
            count = await session.scalar(select(func.count()).select_from(dataset.model))
            return {"record_count": count}
        if legacy and dataset.model is RegistrationRedemption:
            redemption_counts = (
                select(RegistrationRedemption.invite_id, func.count().label("total"))
                .group_by(RegistrationRedemption.invite_id)
                .subquery()
            )
            invalid = await session.scalar(
                select(RegistrationInviteCode.id)
                .outerjoin(
                    redemption_counts, redemption_counts.c.invite_id == RegistrationInviteCode.id
                )
                .where(
                    RegistrationInviteCode.used_count != func.coalesce(redemption_counts.c.total, 0)
                )
                .limit(1)
            )
            if invalid is not None:
                raise HTTPException(409, {"code": "migration_redemption_count_mismatch"})
        owner = dataset.owner_column
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
        .where(dataset.key_column > (after or ""))
        .order_by(dataset.key_column)
        .limit(MAX_RECORDS + 1)
    )
    if not dataset.platform:
        query = query.where(dataset.owner_column == str(owner))
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
        next_cursor=getattr(records[-1], dataset.key_field) if len(rows) > MAX_RECORDS else None,
    )


async def import_batch(database, plan, dataset, batch):
    owner = str(batch.owner_id)
    model = dataset.model
    ids = [getattr(record, dataset.key_field) for record in batch.records]
    if (
        ids != sorted(set(ids))
        or (model is User and ids != [owner])
        or (model is CloudFactor and ids not in ([], [owner]))
    ):
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
        if not dataset.platform and model is not User and await session.get(User, owner) is None:
            raise HTTPException(409, {"code": "migration_owner_missing"})
        if ids and await session.scalar(
            select(dataset.key_column).where(dataset.key_column.in_(ids)).limit(1)
        ):
            raise HTTPException(409, {"code": "migration_identity_overlap"})
        if model is CloudUnlock and ids:
            scoped = await session.scalars(
                select(AuthSession.id).where(AuthSession.user_id == owner, AuthSession.id.in_(ids))
            )
            if set(scoped) != set(ids):
                raise HTTPException(409, {"code": "migration_cloud_session_unassigned"})
        if model is SecurityAuditEvent:
            referenced = {
                account
                for record in batch.records
                for account in (record.actor_user_id, record.target_user_id, record.owner_user_id)
                if account is not None
            }
            if referenced - {str(account) for account in plan.owner_ids}:
                raise HTTPException(409, {"code": "migration_audit_account_unassigned"})
        owned = {}
        if not dataset.platform and dataset.key_field != dataset.owner_field:
            owned[dataset.owner_field] = owner
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
