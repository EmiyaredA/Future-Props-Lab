"""Expose and import only frozen, owned asset bytes with exact SHA256 receipts."""

import asyncio
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid5

from fastapi import HTTPException, Request
from fastapi import Path as RoutePath
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.migration_records import ASSET_CURSOR
from studio.apps.asset_library.storage.models import VisualAsset
from studio.contracts.management.migration_batches import BatchReceipt
from studio.runtime.files.migration_files import import_blob, inspect_blob, inventory_directory
from studio.runtime.http.migration_admission import MigrationAdmission

from .migration_models import AssetImportReceipt

BLOBS = "/v1/migration/assets/blobs"
DATASET = "assets.blobs"
DIGEST = r"^[a-f0-9]{64}$"
AssetParam = Annotated[str, RoutePath(pattern=ASSET_CURSOR)]
DigestParam = Annotated[str, RoutePath(pattern=DIGEST)]
PROJECT_ASSETS = {"visual-workshop", "galgame-workshop", "video-editor", "motion-compositor"}


class AssetBlob(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str = Field(pattern=ASSET_CURSOR)
    size: int = Field(gt=0, strict=True)
    sha256: str = Field(pattern=DIGEST)


def receipt_for(plan, owner, item):
    return BatchReceipt(
        run_id=plan.run_id,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{item.id}"),
        dataset=DATASET,
        sha256=hashlib.sha256(
            json.dumps(item.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        record_count=1,
    )


@dataclass(frozen=True)
class FrozenPaths:
    runtime_path: Path

    def checked(self, *parts):
        result = self.runtime_path
        for part in parts:
            if Path(part).name != part or part in {"", ".", ".."}:
                raise ValueError("迁移文件路径无效")
            result = result / part
            if result.is_symlink():
                raise ValueError("迁移路径包含符号链接")
        return result

    def account_path(self, owner):
        return self.checked("accounts", owner)


class FrozenAssetStorage(AssetStorage):
    def project_root(self, application_id, project_id, *, owner_user_id):
        if application_id not in PROJECT_ASSETS:
            raise ValueError("素材目录归属无效")
        return self.settings.checked(
            "accounts", owner_user_id, "applications", application_id, "projects", project_id
        )

    def owned_path(self, row):
        path = self.path_for(row)
        return self.settings.checked(*path.relative_to(self.settings.runtime_path).parts)

    def asset_directories(self, owner):
        paths = self.settings
        yield paths.checked("accounts", owner, "library", "assets")
        yield paths.checked("accounts", owner, "legacy-assets")
        for application in PROJECT_ASSETS:
            projects = paths.checked("accounts", owner, "applications", application, "projects")
            for project in inventory_directory(projects):
                if project.is_symlink() or not project.is_dir():
                    raise ValueError("素材项目目录无效")
                yield paths.checked(
                    "accounts",
                    owner,
                    "applications",
                    application,
                    "projects",
                    project.name,
                    "assets",
                )


class AssetBlobs:
    def __init__(self, root, sessions):
        self.root, self.sessions = root, sessions
        self.storage = FrozenAssetStorage(FrozenPaths(root))

    async def row(self, owner, asset):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            row = await db.scalar(
                select(VisualAsset).where(
                    VisualAsset.id == asset, VisualAsset.owner_user_id == str(owner)
                )
            )
        if row is None:
            raise HTTPException(404, {"code": "migration_asset_missing"})
        return row

    def verify_owners(self, approved):
        for account in inventory_directory(self.storage.settings.checked("accounts")):
            if account.name not in approved and any(
                path.exists() for path in self.storage.asset_directories(account.name)
            ):
                raise ValueError("素材文件账号未登记")
        for owner in inventory_directory(self.storage.settings.checked(".trash")):
            for application in PROJECT_ASSETS:
                if any(
                    inventory_directory(
                        self.storage.settings.checked(".trash", owner.name, application)
                    )
                ):
                    raise ValueError("素材项目删除暂存需要在旧站恢复")

    def measure(self, row):
        path = self.storage.owned_path(row)
        size, digest = inspect_blob(path, exact_size=row.byte_size)
        return AssetBlob(id=row.id, size=size, sha256=digest), path

    async def inventory(self, owner, *, complete, legacy):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            rows = list(
                await db.scalars(
                    select(VisualAsset)
                    .where(VisualAsset.owner_user_id == str(owner))
                    .order_by(VisualAsset.id)
                )
            )
        return await asyncio.to_thread(self._inventory, str(owner), rows, complete, legacy)

    def _inventory(self, owner, rows, complete, legacy):
        expected = {self.storage.owned_path(row): row for row in rows}
        if len(expected) != len(rows):
            raise ValueError("不同素材指向同一文件")
        found = {}
        upgraded = {row.storage_key: row for row in rows if row.storage_version == 2}
        for folder in self.storage.asset_directories(owner):
            for path in inventory_directory(folder):
                if path.name == ".tmp":
                    inventory_directory(path)
                    continue
                if path not in expected:
                    # A converted source may retain its version-one copy for rollback.
                    old = (
                        upgraded.get(path.name)
                        if legacy and folder.name == "legacy-assets"
                        else None
                    )
                    if (
                        old is None
                        or inspect_blob(path, exact_size=old.byte_size)[1]
                        != self.measure(old)[0].sha256
                    ):
                        raise ValueError("素材存在未登记原件")
                    continue
                record, _ = self.measure(expected[path])
                found[record.id] = record
        if complete and len(found) != len(rows):
            raise ValueError("素材原件缺失")
        return [found[key] for key in sorted(found)]

    async def store(self, request, plan, owner, asset, digest):
        row = await self.row(owner, asset)
        item = AssetBlob(id=asset, size=row.byte_size, sha256=digest)
        receipt = receipt_for(plan, owner, item)
        key = str(plan.run_id), DATASET, str(owner), str(receipt.batch_id)
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            previous = await db.get(AssetImportReceipt, key)
            if previous is not None and BatchReceipt.model_validate(previous.receipt) != receipt:
                raise HTTPException(409, {"code": "migration_batch_conflict"})
        path = self.storage.owned_path(row)
        staging = self.storage.settings.checked(".asset-import-staging")
        await import_blob(
            request.stream(),
            root=self.root,
            target=path,
            staging=staging,
            size=item.size,
            digest=digest,
        )
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            await db.execute(text("BEGIN IMMEDIATE"))
            previous = await db.get(AssetImportReceipt, key)
            if previous is not None:
                if BatchReceipt.model_validate(previous.receipt) != receipt:
                    raise HTTPException(409, {"code": "migration_batch_conflict"})
            else:
                db.add(
                    AssetImportReceipt(
                        run_id=key[0],
                        dataset=key[1],
                        owner_user_id=key[2],
                        batch_id=key[3],
                        receipt=receipt.model_dump(mode="json"),
                    )
                )
                await db.commit()
        return receipt


def mount_blobs(app, plan, sessions, *, root, source=None):
    admission = MigrationAdmission(plan)
    blobs = AssetBlobs(root, sessions)

    def ensure_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError):
                raise HTTPException(409, {"code": "migration_source_changed"}) from None

    @app.get(BLOBS)
    async def accounts():
        ensure_source()
        try:
            await asyncio.to_thread(blobs.verify_owners, {str(owner) for owner in plan.owner_ids})
        except (ValueError, OSError):
            raise HTTPException(409, {"code": "migration_asset_inventory_conflict"}) from None
        ensure_source()
        return {"verified": True}

    @app.get(BLOBS + "/{owner}", response_model=list[AssetBlob])
    async def inventory(owner: UUID, complete: bool = False):
        admission.check_owner(owner)
        ensure_source()
        try:
            result = await blobs.inventory(
                owner, complete=complete or source is not None, legacy=source is not None
            )
        except (OSError, ValueError):
            raise HTTPException(409, {"code": "migration_asset_inventory_conflict"}) from None
        ensure_source()
        return result

    @app.get(BLOBS + "/{owner}/{asset}/{digest}")
    async def original(owner: UUID, asset: AssetParam, digest: DigestParam):
        admission.check_owner(owner)
        ensure_source()
        row = await blobs.row(owner, asset)
        try:
            entry, path = await asyncio.to_thread(blobs.measure, row)
        except (OSError, ValueError):
            raise HTTPException(409, {"code": "migration_asset_bytes_changed"}) from None
        if entry.sha256 != digest:
            raise HTTPException(409, {"code": "migration_asset_bytes_changed"})
        ensure_source()
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(BLOBS + "/{owner}/{asset}/{digest}", response_model=BatchReceipt)
        async def ingest(owner: UUID, asset: AssetParam, digest: DigestParam, request: Request):
            admission.check_owner(owner)
            try:
                return await blobs.store(request, plan, owner, asset, digest)
            except (OSError, ValueError):
                raise HTTPException(409, {"code": "migration_asset_bytes_changed"}) from None
