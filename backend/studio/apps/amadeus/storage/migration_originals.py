"""Inventory durable Amadeus files inside owned conversation roots."""

import asyncio
import hashlib
import os
import re
from pathlib import Path
from typing import Literal
from uuid import uuid5

from pydantic import Field, model_validator
from sqlalchemy import select, text

from app.console.amadeus.files import KINDS, MAX_FILE_BYTES, work_root
from app.console.amadeus.models import AmadeusConversation
from studio.apps.amadeus.storage.migration_history import AmadeusImportReceipt
from studio.contracts.amadeus.amadeus_skills import ID, VERSION
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.migration_receipts import has_receipt, record_receipt
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.files.migration_files import (
    checked_path,
    import_blob,
    inspect_blob,
    inventory_directory,
)

PREFIX = "/v1/migration/amadeus/originals"
DATASET = "amadeus.working-originals"
MAX_ORIGINAL_BYTES = 1024 * 1024 * 1024


class Original(HistoryRecord):
    conversation_id: Identifier
    path: str = Field(min_length=1, max_length=4096)
    kind: Literal["imports", "scripts", "outputs", "skills"]
    size: int = Field(ge=0, le=MAX_ORIGINAL_BYTES)
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")

    @model_validator(mode="after")
    def validate_path(self):
        parts = self.path.split("/")
        if (
            any(part in {"", ".", ".."} for part in parts)
            or "\\" in self.path
            or "\x00" in self.path
            or parts[0] != self.kind
        ):
            raise ValueError("会话原件路径无效")
        if self.kind in KINDS and len(parts) == 2:
            if self.size <= MAX_FILE_BYTES and not parts[1].startswith(".amadeus-"):
                return self
        if (
            self.kind == "skills"
            and len(parts) >= 4
            and re.fullmatch(ID, parts[1])
            and re.fullmatch(VERSION, parts[2])
        ):
            return self
        raise ValueError("会话原件超出工作文件和固定 Skill 目录")


def file_receipt(plan, owner, file):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{file.conversation_id}/{file.path}"),
        sha256=hashlib.sha256(file.model_dump_json().encode()).hexdigest(),
        record_count=1,
    )


def skill_files(path, *, complete):
    def fail(error):
        raise error

    for skill in inventory_directory(path):
        if skill.name.startswith(".amadeus-pin-") and not skill.is_symlink() and skill.is_dir():
            continue
        if not re.fullmatch(ID, skill.name):
            raise ValueError("会话 Skill 标识无效")
        versions = list(inventory_directory(skill))
        if not versions:
            continue
        if len(versions) != 1 or not re.fullmatch(VERSION, versions[0].name):
            raise ValueError("会话 Skill 固定版本冲突")
        version = versions[0]
        if version.is_symlink() or not version.is_dir():
            raise ValueError("会话 Skill 版本目录不安全")
        if complete and not any(
            member.name.casefold() == "skill.md" and member.is_file() and not member.is_symlink()
            for member in inventory_directory(version)
        ):
            raise ValueError("会话 Skill 缺少入口")
        for directory, children, names in os.walk(version, followlinks=False, onerror=fail):
            prefix = Path(directory).relative_to(version).parts
            for child in children:
                checked_path(version, *prefix, child)
            for name in names:
                yield checked_path(version, *prefix, name)


class WorkingOriginals:
    def __init__(self, plan, sessions, root):
        self.plan, self.sessions, self.root = plan, sessions, root

    def root_for(self, owner, conversation):
        try:
            return work_root(str(owner), conversation, files_root=self.root)
        except OperationError as error:
            raise ValueError("会话原件目录不安全") from error

    def check_owners(self):
        approved = {str(owner) for owner in self.plan.owner_ids}
        for account in inventory_directory(checked_path(self.root, "accounts")):
            if (
                checked_path(self.root, "accounts", account.name, "amadeus").exists()
                and account.name not in approved
            ):
                raise ValueError("会话原件账号归属未登记")

    def scan(self, owner, conversations, *, complete):
        base = checked_path(self.root, "accounts", str(owner), "amadeus")
        files = []
        for conversation in inventory_directory(base):
            if conversation.name not in conversations:
                raise ValueError("会话原件存在未登记目录")
            root = self.root_for(owner, conversation.name)
            for entry in inventory_directory(root):
                if entry.name == "tmp" and entry.is_dir() and not entry.is_symlink():
                    continue
                if entry.name == "skills":
                    members = skill_files(entry, complete=complete)
                elif entry.name in KINDS:
                    members = (
                        member
                        for member in inventory_directory(entry)
                        if not (
                            member.name.startswith(".amadeus-")
                            and not member.is_symlink()
                            and member.is_file()
                        )
                    )
                else:
                    raise ValueError("会话原件目录未登记")
                for member in members:
                    size, digest = inspect_blob(
                        member, allow_empty=True, maximum=MAX_ORIGINAL_BYTES
                    )
                    files.append(
                        Original(
                            conversation_id=conversation.name,
                            kind=entry.name,
                            path=member.relative_to(root).as_posix(),
                            size=size,
                            sha256=digest,
                        )
                    )
        return sorted(files, key=lambda file: (file.conversation_id, file.path))

    async def manifest(self, owner, *, complete, require_receipts):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            conversations = set(
                await db.scalars(
                    select(AmadeusConversation.id).where(
                        AmadeusConversation.owner_user_id == str(owner)
                    )
                )
            )
        files = await asyncio.to_thread(self.scan, owner, conversations, complete=complete)
        if require_receipts:
            async with self.sessions(info={"owner_user_id": str(owner)}) as db:
                for file in files:
                    if not await has_receipt(
                        db, AmadeusImportReceipt, file_receipt(self.plan, owner, file)
                    ):
                        raise ValueError("会话原件缺少迁移回执")
        return files

    async def member(self, owner, file):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            row = await db.get(AmadeusConversation, file.conversation_id)
            if row is None or row.owner_user_id != str(owner):
                raise ValueError("会话原件归属不符")
        root = self.root_for(owner, file.conversation_id)
        return checked_path(root, *file.path.split("/"))

    async def read(self, owner, file):
        path = await self.member(owner, file)
        _, digest = await asyncio.to_thread(
            inspect_blob, path, exact_size=file.size, allow_empty=True
        )
        if digest != file.sha256:
            raise ValueError("会话原件摘要不匹配")
        return path

    async def save(self, stream, owner, file):
        path = await self.member(owner, file)
        receipt = file_receipt(self.plan, owner, file)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await has_receipt(db, AmadeusImportReceipt, receipt)
        await import_blob(
            stream,
            root=self.root,
            target=path,
            staging=checked_path(self.root, ".amadeus-import"),
            size=file.size,
            digest=file.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, AmadeusImportReceipt, receipt):
                record_receipt(db, AmadeusImportReceipt, receipt)
                await db.commit()
        return receipt
