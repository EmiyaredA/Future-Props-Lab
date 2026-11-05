"""Stream inference originals identified by their owned database records."""

import asyncio
import re
from typing import Literal
from uuid import uuid5

from pydantic import Field
from sqlalchemy import select, text

from studio.apps.model_service.catalog_migration import ModelsImportReceipt
from studio.apps.model_service.storage.migration_inference import INPUT_KEY, OUTPUT_KEY
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.contracts.management.migration_batches import BatchReceipt
from studio.contracts.management.project_history import HistoryRecord, Identifier
from studio.runtime.database.migration_receipts import has_receipt, record_receipt
from studio.runtime.files.migration_files import (
    checked_path,
    import_blob,
    inspect_blob,
    inventory_directory,
)

PREFIX = "/v1/migration/models/inference-originals"
DATASET = "models.inference-originals"
Kind = Literal["inputs", "outputs"]


class Original(HistoryRecord):
    kind: Kind
    id: Identifier
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def receipt_for(plan, owner, item):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=DATASET,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{item.kind}/{item.id}"),
        sha256=item.sha256,
        record_count=1,
    )


def shape(kind):
    if kind == "inputs":
        return ModelInferenceAsset, ModelInferenceAsset.storage_key, ModelInferenceAsset.byte_size
    return (
        ModelInferenceTask,
        ModelInferenceTask.result_storage_key,
        ModelInferenceTask.result_byte_size,
    )


class InferenceOriginals:
    def __init__(self, plan, sessions, root, *, legacy):
        self.plan, self.sessions, self.root, self.legacy = plan, sessions, root, legacy

    def account_root(self, owner):
        return checked_path(self.root, "accounts", str(owner), "model-inference")

    def check_owners(self):
        approved = {str(owner) for owner in self.plan.owner_ids}
        for account in inventory_directory(checked_path(self.root, "accounts")):
            if self.account_root(account.name).exists() and account.name not in approved:
                raise ValueError("推理文件目录的账号未登记")

    def path(self, owner, kind, key):
        pattern = INPUT_KEY if kind == "inputs" else OUTPUT_KEY
        if not re.fullmatch(pattern, key):
            raise ValueError("推理文件名无效")
        return checked_path(self.account_root(owner), kind, key)

    async def records(self, owner, kind, identifier=None):
        model, key, size = shape(kind)
        query = select(model.id, key, size).where(model.owner_user_id == str(owner), key != "")
        if identifier is not None:
            query = query.where(model.id == identifier)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            return (await db.execute(query)).all()

    async def find(self, owner, item):
        rows = await self.records(owner, item.kind, item.id)
        if len(rows) != 1 or rows[0][2] != item.size:
            raise ValueError("推理文件记录不存在或大小不符")
        return self.path(owner, item.kind, rows[0][1])

    def scan(self, owner, kind, records, *, complete):
        root = self.account_root(owner)
        expected = {
            self.path(owner, kind, key): (identifier, size) for identifier, key, size in records
        }
        if len(expected) != len(records):
            raise ValueError("推理文件记录指向重复原件")
        found = []
        for path in inventory_directory(checked_path(root, kind)):
            if path not in expected:
                if (
                    self.legacy
                    and kind == "outputs"
                    and re.fullmatch(rf"{INPUT_KEY}\.tmp", path.name)
                    and not path.is_symlink()
                    and path.is_file()
                ):
                    continue
                raise ValueError("推理目录存在未登记原件")
            identifier, size = expected[path]
            _, sha256 = inspect_blob(path, exact_size=size)
            found.append(Original(kind=kind, id=identifier, size=size, sha256=sha256))
        if complete and len(found) != len(records):
            raise ValueError("推理目录缺少原件")
        return found

    async def manifest(self, owner, *, complete):
        files = []
        for kind in ("inputs", "outputs"):
            files.extend(
                await asyncio.to_thread(
                    self.scan,
                    owner,
                    kind,
                    await self.records(owner, kind),
                    complete=complete or self.legacy,
                )
            )
        if complete and not self.legacy:
            async with self.sessions(info={"owner_user_id": str(owner)}) as db:
                for item in files:
                    if not await has_receipt(
                        db, ModelsImportReceipt, receipt_for(self.plan, owner, item)
                    ):
                        raise ValueError("推理文件缺少迁移回执")
        return sorted(files, key=lambda item: (item.kind, item.id))

    async def read(self, owner, item):
        path = await self.find(owner, item)
        _, digest = await asyncio.to_thread(inspect_blob, path, exact_size=item.size)
        if digest != item.sha256:
            raise ValueError("推理文件摘要不一致")
        return path

    async def save(self, stream, owner, item):
        path = await self.find(owner, item)
        expected = receipt_for(self.plan, owner, item)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await has_receipt(db, ModelsImportReceipt, expected)
        await import_blob(
            stream,
            root=self.root,
            target=path,
            staging=checked_path(self.root, ".model-inference-import"),
            size=item.size,
            digest=item.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, ModelsImportReceipt, expected):
                record_receipt(db, ModelsImportReceipt, expected)
                await db.commit()
        return expected
