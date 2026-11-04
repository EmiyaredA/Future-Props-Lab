"""Run-bound, canonical migration batches and account-checked receipts."""

import hashlib
import json
import os
import secrets
import stat
from pathlib import Path
from typing import Generic, TypeVar
from uuid import UUID

from fastapi import HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, SecretStr, field_validator

Record = TypeVar("Record")
MAX_RECORDS = 256


class MigrationPlan(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: UUID
    source_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    source_database_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    owner_ids: tuple[UUID, ...] = Field(max_length=100000)
    token: SecretStr

    @field_validator("token")
    @classmethod
    def check_token(cls, token):
        value = token.get_secret_value()
        if not 32 <= len(value) <= 256 or not value.isascii() or not value.isprintable():
            raise ValueError("迁移凭据格式无效")
        return token

    @field_validator("owner_ids")
    @classmethod
    def unique_owners(cls, owners):
        if len(set(owners)) != len(owners):
            raise ValueError("迁移账号清单包含重复项")
        return owners

    @classmethod
    def read(cls, path: Path):
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
            raise ValueError("迁移计划必须为本用户独占的普通文件")
        return cls.model_validate_json(path.read_text())


class MigrationBatch(BaseModel, Generic[Record]):
    model_config = ConfigDict(extra="forbid", frozen=True)

    run_id: UUID
    source_revision: str = Field(pattern=r"^[a-f0-9]{40}$")
    source_database_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    dataset: str
    owner_id: UUID
    batch_id: UUID
    records: tuple[Record, ...] = Field(max_length=MAX_RECORDS)

    @property
    def digest(self):
        body = json.dumps(
            self.model_dump(mode="json"), ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode()
        return hashlib.sha256(body).hexdigest()


Batch = TypeVar("Batch", bound=MigrationBatch)


class MigrationPage(BaseModel, Generic[Batch]):
    model_config = ConfigDict(extra="forbid", frozen=True)

    batch: Batch
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    next_cursor: str | None


class BatchReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    run_id: UUID
    owner_id: UUID
    batch_id: UUID
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    record_count: int = Field(ge=0, le=MAX_RECORDS)
    dataset: str


class MigrationAdmission:
    def __init__(self, plan):
        self.plan = plan
        self.owners = frozenset(plan.owner_ids)
        self.secret = plan.token.get_secret_value().encode()

    def authorize(self, request: Request):
        supplied = request.headers.get("X-Fpl-Migration-Token", "").encode()
        if (
            "origin" in request.headers
            or "cookie" in request.headers
            or not secrets.compare_digest(supplied, self.secret)
        ):
            raise HTTPException(403, {"code": "migration_authority_required"})

    def check_owner(self, owner):
        if owner not in self.owners:
            raise HTTPException(409, {"code": "migration_owner_unassigned"})

    def check_batch(self, request: Request, batch):
        self.check_owner(batch.owner_id)
        if (
            batch.run_id != self.plan.run_id
            or batch.source_revision != self.plan.source_revision
            or batch.source_database_sha256 != self.plan.source_database_sha256
        ):
            raise HTTPException(409, {"code": "migration_source_mismatch"})
        supplied = request.headers.get("X-Fpl-Migration-SHA256", "").encode()
        if not secrets.compare_digest(supplied, batch.digest.encode()):
            raise HTTPException(422, {"code": "migration_digest_mismatch"})
