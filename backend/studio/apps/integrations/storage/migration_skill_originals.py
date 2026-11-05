"""Inventory and receive originals under the authorized Skill version."""

from asyncio import to_thread

from sqlalchemy import select, text

from studio.apps.integrations.storage.catalog_migration import IntegrationsImportReceipt
from studio.apps.integrations.storage.migration_skill_files import (
    checked_member,
    inventory_version,
    version_directory,
)
from studio.apps.integrations.storage.models import SkillIntegration, SkillVersion
from studio.contracts.integrations.skill_migration import file_receipt
from studio.runtime.database.migration_receipts import has_receipt, record_receipt
from studio.runtime.files.migration_files import (
    checked_path,
    import_blob,
    inspect_blob,
    inventory_directory,
)


class SkillOriginalConflict(ValueError):
    def __init__(self, code):
        self.code = code


class SkillOriginals:
    def __init__(self, root, sessions, plan):
        self.root, self.sessions, self.plan = root, sessions, plan

    async def version(self, owner, skill, version):
        async with self.sessions(info={"owner_user_id": str(owner)}) as session:
            row = await session.scalar(
                select(SkillVersion)
                .join(SkillIntegration, SkillIntegration.id == SkillVersion.skill_id)
                .where(
                    SkillIntegration.owner_user_id == str(owner),
                    SkillIntegration.id == skill,
                    SkillVersion.version == version,
                )
            )
        if row is None:
            raise SkillOriginalConflict("migration_skill_version_unavailable")
        return row

    def verify_account_roots(self):
        accounts = checked_path(self.root, "accounts")
        approved = {str(owner) for owner in self.plan.owner_ids}
        for account in inventory_directory(accounts):
            if account.name not in approved and any(
                inventory_directory(checked_path(accounts, account.name, "integrations", "skills"))
            ):
                raise ValueError("存在未登记账号的 Skill 文件")
        trash = checked_path(self.root, ".trash", "integrations")
        if any(inventory_directory(trash)):
            raise ValueError("Skill 删除暂存尚未完成恢复")

    async def verify_owner(self, owner):
        async with self.sessions(info={"owner_user_id": str(owner)}) as session:
            owned = list(
                await session.scalars(
                    select(SkillIntegration).where(SkillIntegration.owner_user_id == str(owner))
                )
            )
            versions = await session.execute(
                select(SkillVersion.skill_id, SkillVersion.version)
                .join(SkillIntegration, SkillIntegration.id == SkillVersion.skill_id)
                .where(SkillIntegration.owner_user_id == str(owner))
            )
            expected = {row.id: set() for row in owned}
            for skill, version in versions:
                expected[skill].add(version)
            for row in owned:
                present = expected[row.id]
                if not {
                    row.default_version,
                    row.latest_version,
                } <= present or row.latest_version != max(
                    present, key=lambda version: int(version[1:])
                ):
                    raise SkillOriginalConflict("migration_skill_active_version_missing")
        root = checked_path(self.root, "accounts", str(owner), "integrations", "skills")
        actual = {}
        for directory in inventory_directory(root):
            # Stage directories or undeclared originals must be resolved before cutover.
            actual[directory.name] = {version.name for version in inventory_directory(directory)}
        if actual != expected:
            raise ValueError("Skill 文件目录与版本记录不匹配")

    async def manifest(self, owner, skill, version, *, complete, require_receipts):
        row = await self.version(owner, skill, version)
        directory = version_directory(self.root, str(owner), skill, version)
        files = await to_thread(
            inventory_version,
            directory,
            file_count=row.file_count,
            expanded_bytes=row.expanded_bytes,
            complete=complete,
        )
        if require_receipts:
            async with self.sessions(info={"owner_user_id": str(owner)}) as session:
                for file in files:
                    expected = file_receipt(self.plan, owner, skill, version, file)
                    if not await has_receipt(session, IntegrationsImportReceipt, expected):
                        raise SkillOriginalConflict("migration_skill_file_unverified")
        return files

    async def read(self, owner, skill, version, file):
        row = await self.version(owner, skill, version)
        directory = version_directory(self.root, str(owner), skill, version)
        path = checked_member(directory, file.path)
        size, digest = await to_thread(
            inspect_blob, path, exact_size=file.size, maximum=row.expanded_bytes, allow_empty=True
        )
        if size != file.size or digest != file.sha256:
            raise ValueError("Skill 原件摘要不符")
        return path

    async def save(self, stream, owner, skill, version, file):
        row = await self.version(owner, skill, version)
        if file.size > row.expanded_bytes:
            raise ValueError("Skill 文件超过版本大小")
        directory = version_directory(self.root, str(owner), skill, version)
        target = checked_member(directory, file.path)
        staging = checked_path(self.root, ".skill-import-staging")
        receipt = file_receipt(self.plan, owner, skill, version, file)
        async with self.sessions(info={"owner_user_id": str(owner)}) as session:
            await has_receipt(session, IntegrationsImportReceipt, receipt)
        await import_blob(
            stream,
            root=self.root,
            target=target,
            staging=staging,
            size=file.size,
            digest=file.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as session:
            await session.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(session, IntegrationsImportReceipt, receipt):
                record_receipt(session, IntegrationsImportReceipt, receipt)
                await session.commit()
        return receipt
