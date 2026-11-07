"""Stream Models originals identified by their owned database records."""

import asyncio
import re
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal
from uuid import uuid5

from pydantic import Field
from sqlalchemy import select, text, union_all

from studio.apps.model_service.catalog_migration import ModelsImportReceipt
from studio.apps.model_service.storage.models.model_inference import (
    ModelInferenceAsset,
    ModelInferenceTask,
)
from studio.apps.model_service.storage.models.model_test import (
    ModelTestAttachment,
    ModelTestConversation,
    ModelTestGenerationAsset,
    ModelTestGenerationTask,
    ModelTestTranscriptionTask,
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

FILE_KEY = r"[a-f0-9]{32}"
OUTPUT_KEY = rf"(?:{FILE_KEY}|native-[a-f0-9]{{8}}(?:-[a-f0-9]{{4}}){{3}}-[a-f0-9]{{12}})"
StorageKey = Annotated[str, Field(pattern=f"^{FILE_KEY}$")]
OutputKey = Annotated[str, Field(pattern=f"^{OUTPUT_KEY}$")]
Kind = Literal["inputs", "outputs", "attachments", "generated", "references"]


@dataclass(frozen=True)
class OriginalSet:
    name: str
    folder: str
    kinds: tuple[Kind, ...]

    @property
    def dataset(self):
        return f"models.{self.name}-originals"

    @property
    def prefix(self):
        return f"/v1/migration/models/{self.name}-originals"


INFERENCE = OriginalSet("inference", "model-inference", ("inputs", "outputs"))
ATTACHMENTS = OriginalSet("test-attachment", "model-test", ("attachments",))
PLAYGROUND_TASKS = OriginalSet("test-task", "model-test", ("generated", "references"))


@dataclass(frozen=True)
class LegacyTranscriptionInputs:
    recovered: Mapping[str, Path]
    unavailable: frozenset[str]


class Original(HistoryRecord):
    kind: Kind
    id: Identifier
    size: int = Field(gt=0)
    sha256: str = Field(pattern=r"^[0-9a-f]{64}$")


def receipt_for(plan, owner, item, scope):
    return BatchReceipt(
        run_id=plan.run_id,
        dataset=scope.dataset,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{scope.dataset}/{owner}/{item.kind}/{item.id}"),
        sha256=item.sha256,
        record_count=1,
    )


def records_for(kind, owner):
    if kind == "attachments":
        model = ModelTestAttachment
        return (
            select(model.id, model.storage_key, model.byte_size)
            .join(ModelTestConversation, ModelTestConversation.id == model.conversation_id)
            .where(ModelTestConversation.owner_user_id == owner)
        )
    if kind == "inputs":
        model = ModelInferenceAsset
        return select(model.id, model.storage_key, model.byte_size).where(
            model.owner_user_id == owner
        )
    if kind == "generated":
        model = ModelTestGenerationTask
        return select(model.id, model.result_storage_key, model.result_byte_size).where(
            model.owner_user_id == owner, model.result_storage_key != ""
        )
    if kind == "references":
        asset = ModelTestGenerationAsset
        task = ModelTestTranscriptionTask
        records = union_all(
            select(asset.id, asset.storage_key, asset.byte_size).where(
                asset.owner_user_id == owner
            ),
            select(task.id, task.input_storage_key, task.input_byte_size).where(
                task.owner_user_id == owner
            ),
        ).subquery()
        return select(records.c.id, records.c.storage_key, records.c.byte_size)
    model = ModelInferenceTask
    return select(model.id, model.result_storage_key, model.result_byte_size).where(
        model.owner_user_id == owner, model.result_storage_key != ""
    )


class ModelOriginals:
    def __init__(self, plan, sessions, root, scope, *, legacy, transcription_inputs=None):
        self.plan, self.sessions, self.root, self.scope = plan, sessions, root, scope
        self.legacy = legacy
        self.transcription_inputs = transcription_inputs

    def account_root(self, owner):
        return checked_path(self.root, "accounts", str(owner), self.scope.folder)

    def check_owners(self):
        approved = {str(owner) for owner in self.plan.owner_ids}
        for account in inventory_directory(checked_path(self.root, "accounts")):
            if self.account_root(account.name).exists() and account.name not in approved:
                raise ValueError("模型文件目录的账号未登记")

    def path(self, owner, kind, key):
        pattern = OUTPUT_KEY if kind == "outputs" else FILE_KEY
        if not re.fullmatch(pattern, key):
            raise ValueError("模型文件名无效")
        return checked_path(self.account_root(owner), kind, key)

    async def records(self, owner, kind, identifier=None):
        if kind not in self.scope.kinds:
            raise ValueError("模型文件类型不属于本次传输")
        query = records_for(kind, str(owner))
        if identifier is not None:
            query = query.where(query.selected_columns.id == identifier)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            return (await db.execute(query)).all()

    async def find(self, owner, item):
        rows = await self.records(owner, item.kind, item.id)
        if len(rows) != 1 or rows[0][2] != item.size:
            raise ValueError("模型文件记录不存在或大小不符")
        return self.path(owner, item.kind, rows[0][1])

    def recovered_path(self, kind, identifier):
        if not self.legacy or kind != "references" or self.transcription_inputs is None:
            return None
        recovered = self.transcription_inputs.recovered.get(identifier)
        if recovered is not None:
            return checked_path(self.root, *recovered.relative_to(self.root).parts)
        return None

    def scan(self, owner, kind, records, *, complete):
        root = self.account_root(owner)
        expected = {
            self.path(owner, kind, key): (identifier, size) for identifier, key, size in records
        }
        if len(expected) != len(records):
            raise ValueError("模型文件记录指向重复原件")
        if len({identifier for identifier, _, _ in records}) != len(records):
            raise ValueError("模型文件清单存在重复标识")
        found = []
        remaining = expected.copy()
        for path in inventory_directory(checked_path(root, kind)):
            if path not in expected:
                if self.legacy and self.is_staging(kind, path):
                    continue
                raise ValueError("模型目录存在未登记原件")
            identifier, size = expected[path]
            _, sha256 = inspect_blob(path, exact_size=size)
            found.append(Original(kind=kind, id=identifier, size=size, sha256=sha256))
            remaining.pop(path)
        for identifier, size in remaining.values():
            recovered = self.recovered_path(kind, identifier)
            if recovered is not None:
                _, sha256 = inspect_blob(recovered, exact_size=size)
                found.append(Original(kind=kind, id=identifier, size=size, sha256=sha256))
            elif complete and not (
                kind == "references"
                and self.transcription_inputs is not None
                and identifier in self.transcription_inputs.unavailable
            ):
                raise ValueError("模型目录缺少原件")
        return found

    @staticmethod
    def is_staging(kind, path):
        if path.is_symlink():
            return False
        if (
            kind in {"attachments", "generated", "references"}
            and path.name == ".tmp"
            and path.is_dir()
        ):
            pattern = rf"{FILE_KEY}(?:\.tmp)?" if kind == "references" else FILE_KEY
            return all(
                re.fullmatch(pattern, item.name) and not item.is_symlink() and item.is_file()
                for item in path.iterdir()
            )
        return kind == "outputs" and re.fullmatch(rf"{FILE_KEY}\.tmp", path.name) and path.is_file()

    async def manifest(self, owner, *, complete):
        files = []
        for kind in self.scope.kinds:
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
                        db, ModelsImportReceipt, receipt_for(self.plan, owner, item, self.scope)
                    ):
                        raise ValueError("模型文件缺少迁移回执")
        return sorted(files, key=lambda item: (item.kind, item.id))

    async def read(self, owner, item):
        path = await self.find(owner, item)
        if not path.exists():
            path = self.recovered_path(item.kind, item.id) or path
        _, digest = await asyncio.to_thread(inspect_blob, path, exact_size=item.size)
        if digest != item.sha256:
            raise ValueError("模型文件摘要不一致")
        return path

    async def save(self, stream, owner, item):
        path = await self.find(owner, item)
        expected = receipt_for(self.plan, owner, item, self.scope)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await has_receipt(db, ModelsImportReceipt, expected)
        await import_blob(
            stream,
            root=self.root,
            target=path,
            staging=checked_path(self.root, f".model-{self.scope.name}-import"),
            size=item.size,
            digest=item.sha256,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            if not await has_receipt(db, ModelsImportReceipt, expected):
                record_receipt(db, ModelsImportReceipt, expected)
                await db.commit()
        return expected
