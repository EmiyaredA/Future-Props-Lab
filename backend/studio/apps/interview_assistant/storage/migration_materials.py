"""Publish only Interview materials recorded under an owned legacy room."""

import asyncio
from uuid import uuid5

from sqlalchemy import select, text

from studio.apps.interview_assistant.files import MAX_FILE_BYTES, material_path
from studio.apps.interview_assistant.storage.migration_records import (
    InterviewImportReceipt,
    Material,
)
from studio.apps.interview_assistant.storage.models import InterviewMaterial, InterviewRoom
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.database.migration_receipts import has_receipt, record_receipt
from studio.runtime.database.operation_receipts import OperationError
from studio.runtime.files.migration_files import (
    checked_path,
    import_blob,
    inspect_blob,
    inventory_directory,
)

PREFIX = "/v1/migration/interview/originals"
DATASET = "interview.originals"


def file_receipt(plan, owner, material):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{material.room_id}/{material.id}"),
        sha256=material.sha256,
        record_count=1,
    )


class Materials:
    def __init__(self, plan, sessions, root):
        self.plan, self.sessions, self.root = plan, sessions, root

    def path(self, owner, item):
        try:
            return material_path(
                str(owner),
                item.room_id,
                item.id,
                item.filename,
                state_root=self.root,
            )
        except OperationError as error:
            raise ValueError("材料路径无效") from error

    def verify(self, path, item):
        _, digest = inspect_blob(path, exact_size=item.size, maximum=MAX_FILE_BYTES)
        if digest != item.sha256:
            raise ValueError("面试材料摘要不一致")

    async def find(self, owner, room, identifier):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            row = await db.scalar(
                select(InterviewMaterial)
                .join(InterviewRoom, InterviewRoom.id == InterviewMaterial.room_id)
                .where(
                    InterviewRoom.owner_user_id == str(owner),
                    InterviewMaterial.room_id == room,
                    InterviewMaterial.id == identifier,
                )
            )
        if row is None:
            raise ValueError("面试材料不存在")
        return Material.model_validate(row, from_attributes=True)

    async def list_rows(self, owner):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            rows = await db.scalars(
                select(InterviewMaterial)
                .join(InterviewRoom, InterviewRoom.id == InterviewMaterial.room_id)
                .where(InterviewRoom.owner_user_id == str(owner))
                .order_by(InterviewMaterial.id)
            )
            return [Material.model_validate(row, from_attributes=True) for row in rows]

    def check_owners(self):
        approved = {str(owner) for owner in self.plan.owner_ids}
        for account in inventory_directory(checked_path(self.root, "accounts")):
            folder = checked_path(self.root, "accounts", account.name, "interview-assistant")
            if folder.exists() and account.name not in approved:
                raise ValueError("面试材料目录归属未登记")

    def scan(self, owner, items, complete):
        expected = {self.path(owner, item): item for item in items}
        root = checked_path(self.root, "accounts", str(owner), "interview-assistant")
        found = []
        for room in inventory_directory(root):
            if not room.is_dir():
                raise ValueError("面试场次目录无效")
            materials = checked_path(root, room.name, "materials")
            for path in inventory_directory(materials):
                item = expected.get(path)
                if item is None:
                    raise ValueError("面试材料存在未登记文件")
                self.verify(path, item)
                found.append(item)
        if complete and len(found) != len(items):
            raise ValueError("面试材料缺少原件")
        return sorted(found, key=lambda item: item.id)

    async def manifest(self, owner, *, complete, require_receipts):
        files = await asyncio.to_thread(self.scan, owner, await self.list_rows(owner), complete)
        if require_receipts:
            async with self.sessions(info={"owner_user_id": str(owner)}) as db:
                for item in files:
                    if not await has_receipt(
                        db,
                        InterviewImportReceipt,
                        file_receipt(self.plan, owner, item),
                    ):
                        raise ValueError("面试材料缺少迁移回执")
        return files

    async def read(self, owner, room, identifier):
        item = await self.find(owner, room, identifier)
        path = self.path(owner, item)
        await asyncio.to_thread(self.verify, path, item)
        return path

    async def save(self, stream, owner, room, identifier):
        item = await self.find(owner, room, identifier)
        expected = file_receipt(self.plan, owner, item)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await has_receipt(db, InterviewImportReceipt, expected)
        await import_blob(
            stream,
            root=self.root,
            target=self.path(owner, item),
            staging=checked_path(self.root, ".interview-import"),
            size=item.size,
            digest=item.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, InterviewImportReceipt, expected):
                record_receipt(db, InterviewImportReceipt, expected)
                await db.commit()
        return expected
