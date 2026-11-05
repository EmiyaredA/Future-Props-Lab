"""Derive Creative originals from owned catalog records and verify each file."""

import asyncio
import hashlib
from uuid import uuid5

from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.console.creative_workshop.models import CreativeItem, CreativeRelease
from studio.apps.creative_workshop.storage.migration_catalog import CreativeImportReceipt
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.database.migration_receipts import has_receipt, record_receipt
from studio.runtime.files.migration_files import (
    checked_path,
    import_blob,
    inspect_blob,
    inventory_directory,
)
from studio.runtime.files.skill_tree import skill_tree_sha256

PREFIX = "/v1/migration/creative/originals"
DATASET = "creative.originals"
FILE_MAX = 1024 * 1024 * 1024


class Original(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    path: str = Field(min_length=1, max_length=4096)
    size: int = Field(ge=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def receipt(plan, owner, file):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{file.path}"),
        sha256=hashlib.sha256(file.model_dump_json().encode()).hexdigest(),
        record_count=1,
    )


class Originals:
    def __init__(self, plan, sessions, root):
        self.plan, self.sessions, self.root = plan, sessions, root

    async def references(self, owner):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            items = list(
                await db.scalars(
                    select(CreativeItem).where(CreativeItem.origin_owner_user_id == str(owner))
                )
            )
            releases = list(
                await db.scalars(
                    select(CreativeRelease)
                    .join(CreativeItem, CreativeItem.id == CreativeRelease.item_id)
                    .where(CreativeItem.origin_owner_user_id == str(owner))
                )
            )
        covers = {row.draft_cover_path for row in items} | {row.cover_path for row in releases}
        trees = {row.draft_skill_path: row.draft_manifest for row in items if row.draft_skill_path}
        trees.update({row.skill_path: row.manifest for row in releases if row.skill_path})
        return covers - {""}, trees

    def member(self, owner, relative):
        parts = relative.split("/")
        if parts[0] != "creative-workshop" or "\x00" in relative:
            raise ValueError("创作文件路径无效")
        return checked_path(self.root, "accounts", str(owner), *parts)

    def inventory(self, owner, covers, trees, complete):
        paths = set()
        for relative in covers:
            path = self.member(owner, relative)
            if complete or path.exists():
                paths.add(relative)
        for relative, meta in trees.items():
            root = self.member(owner, relative)
            pending = [root]
            members = []
            while pending:
                for child in inventory_directory(pending.pop()):
                    if child.is_symlink():
                        raise ValueError("创作 Skill 包含符号链接")
                    if child.is_dir():
                        pending.append(child)
                    else:
                        members.append(child)
                        if len(members) > 10000:
                            raise ValueError("创作 Skill 文件过多")
            if complete:
                if len(members) != meta.get("file_count") or sum(
                    p.stat().st_size for p in members
                ) != meta.get("expanded_bytes"):
                    raise ValueError("创作 Skill 文件与版本记录不一致")
                if not any(p.name.casefold() == "skill.md" and p.parent == root for p in members):
                    raise ValueError("创作 Skill 缺少入口")
                if expected := meta.get("tree_sha256"):
                    if skill_tree_sha256(root, max_files=10000, max_bytes=FILE_MAX) != expected:
                        raise ValueError("创作 Skill 树摘要不符")
            paths.update(relative + "/" + p.relative_to(root).as_posix() for p in members)
        files = []
        for relative in sorted(paths):
            size, digest = inspect_blob(
                self.member(owner, relative), maximum=FILE_MAX, allow_empty=True
            )
            files.append(Original(path=relative, size=size, sha256=digest))
        return files

    async def manifest(self, owner, *, complete, require_receipts):
        covers, trees = await self.references(owner)
        files = await asyncio.to_thread(self.inventory, owner, covers, trees, complete)
        if require_receipts:
            async with self.sessions(info={"owner_user_id": str(owner)}) as db:
                for file in files:
                    if not await has_receipt(
                        db, CreativeImportReceipt, receipt(self.plan, owner, file)
                    ):
                        raise ValueError("创作文件缺少迁移回执")
        return files

    async def member_for(self, owner, file):
        covers, trees = await self.references(owner)
        if file.path not in covers and not any(file.path.startswith(tree + "/") for tree in trees):
            raise ValueError("创作文件不属于该账号")
        if file.size > FILE_MAX:
            raise ValueError("创作文件超过大小限制")
        return self.member(owner, file.path)

    async def read(self, owner, file):
        path = await self.member_for(owner, file)
        _, digest = await asyncio.to_thread(
            inspect_blob, path, exact_size=file.size, maximum=FILE_MAX, allow_empty=True
        )
        if digest != file.sha256:
            raise ValueError("创作文件摘要不符")
        return path

    async def save(self, stream, owner, file):
        path = await self.member_for(owner, file)
        expected = receipt(self.plan, owner, file)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await has_receipt(db, CreativeImportReceipt, expected)
        await import_blob(
            stream,
            root=self.root,
            target=path,
            staging=checked_path(self.root, ".creative-import"),
            size=file.size,
            digest=file.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, CreativeImportReceipt, expected):
                record_receipt(db, CreativeImportReceipt, expected)
                await db.commit()
        return expected
