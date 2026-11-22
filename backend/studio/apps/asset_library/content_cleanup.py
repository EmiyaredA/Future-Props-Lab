"""Journaled exact-duplicate removal and reconstruction via the retained original."""

import copy
import os
import shutil
from datetime import datetime
from uuid import uuid4

from sqlalchemy import select, text

from studio.apps.asset_library.content_fingerprints import (
    content_key,
    measure,
    original_path,
    snapshot,
)
from studio.apps.asset_library.references.references import protect_references
from studio.apps.asset_library.storage.content_models import (
    AssetDedupeCanonicalPin,
    AssetDedupeOperation,
)
from studio.apps.asset_library.storage.models import VisualAsset
from studio.contracts.asset_library.errors import AssetError
from studio.runtime.tasks.blocking_io import run_blocking_io
from studio.runtime.time import utc_now


def copy_original(source, temporary, target, size, expected, owner, kind):
    """Never overwrite an unrelated file; keep a matching reserved file on retry."""
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists():
        temporary.parent.mkdir(parents=True, exist_ok=True)
        try:
            with source.open("rb") as original, temporary.open("xb") as output:
                shutil.copyfileobj(original, output)
                output.flush()
                os.fsync(output.fileno())
            _, digest = measure(temporary, size)
            if content_key(owner, kind, size, digest) != expected:
                raise OSError("canonical original changed")
            # Link is exclusive: a competing replay can only publish identical bytes.
            try:
                os.link(temporary, target)
            except FileExistsError:
                pass
        finally:
            temporary.unlink(missing_ok=True)
    _, digest = measure(target, size)
    if content_key(owner, kind, size, digest) != expected:
        raise OSError("reserved path has different content")


def restored_row(item):
    values = dict(item)
    for key in ("created_at", "updated_at"):
        if isinstance(values.get(key), str):
            values[key] = datetime.fromisoformat(values[key])
    return VisualAsset(**values)


class ContentCleanup:
    def __init__(self, audits):
        self.audits, self.files = audits, audits.files
        self.session, self.owner = audits.session, audits.owner

    async def pin(self, operation, key, asset_id):
        row = await self.session.get(AssetDedupeCanonicalPin, (operation, key))
        if row is None:
            self.session.add(
                AssetDedupeCanonicalPin(
                    operation_id=operation,
                    content_key=key,
                    owner_user_id=self.owner,
                    asset_id=asset_id,
                )
            )
        else:
            row.asset_id = asset_id

    async def prepare(self, operation, step):
        version, document = await self.audits.load(operation)
        group = self.audits.group(document, step.content_key)
        state = group["public"]["state"]
        if state in ("ready", "cleaned", "restored"):
            return await self.audits.status(operation)
        if version != step.expected_revision:
            raise AssetError("去重操作已变化", code="dedupe_conflict", status=409)
        if state == "audited":
            await self.audits.revalidate(document, group)
            source = next(
                item for item in group["originals"] if item["id"] == group["public"]["canonical_id"]
            )
            projects = {item["project_id"] for item in group["originals"] if item["project_id"]}
            if source["project_id"] is not None and len(projects) > 1:
                canonical = copy.deepcopy(source)
                canonical.update(
                    id=str(uuid4()),
                    project_id=None,
                    folder_id=None,
                    storage_version=2,
                    storage_key=uuid4().hex,
                    revision=0,
                    created_at=utc_now().isoformat(),
                    updated_at=utc_now().isoformat(),
                )
                group["canonical"] = canonical
            group["public"]["state"] = "reserved"
            await self.session.rollback()
            await self.session.execute(text("BEGIN IMMEDIATE"))
            await self.pin(operation, step.content_key, source["id"])
            await self.audits.save(operation, version, document)
            version += 1
        source = next(
            item for item in group["originals"] if item["id"] == group["public"]["canonical_id"]
        )
        canonical = group.get("canonical")
        if canonical:
            source_path = original_path(self.files, source)
            temporary, target = self.files.storage.prepare_write(
                canonical["storage_key"],
                visual_project_id=None,
                galgame_project_id=None,
                owner_user_id=self.owner,
            )
            try:
                await run_blocking_io(
                    copy_original,
                    source_path,
                    temporary,
                    target,
                    canonical["byte_size"],
                    step.content_key,
                    self.owner,
                    canonical["media_kind"],
                )
            except (OSError, ValueError) as exc:
                raise AssetError(
                    "共享原件准备未完成，可安全重试", code="dedupe_copy_failed", status=503
                ) from exc
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        current = await self.session.scalar(
            select(AssetDedupeOperation.revision).where(
                AssetDedupeOperation.id == operation,
                AssetDedupeOperation.owner_user_id == self.owner,
            )
        )
        if current != version:
            await self.session.rollback()
            return await self.audits.status(operation)
        if canonical:
            self.session.add(restored_row(canonical))
            await self.session.flush()
            group["public"]["canonical_id"] = canonical["id"]
        group["public"]["state"] = "ready"
        await self.pin(operation, step.content_key, group["public"]["canonical_id"])
        await self.audits.save(operation, version, document)
        return await self.audits.status(operation)

    async def clean(self, operation, step):
        version, document = await self.audits.load(operation)
        group = self.audits.group(document, step.content_key)
        public = group["public"]
        if public["state"] == "cleaned":
            await self.purge(group)
            return await self.audits.status(operation)
        if public["state"] == "restored":
            return await self.audits.status(operation)
        if public["state"] != "ready" or version != step.expected_revision:
            raise AssetError("先准备保留原件并读取最新版本", code="dedupe_conflict", status=409)
        if set(step.remove_asset_ids) - {item["id"] for item in group["originals"]}:
            raise AssetError("清理标识不属于已审计内容组", code="dedupe_conflict", status=409)
        await self.audits.revalidate(document, group)
        await self.session.rollback()
        await self.session.execute(text("BEGIN IMMEDIATE"))
        for item in group["originals"]:
            identity = item["id"]
            if identity == public["canonical_id"]:
                continue
            if identity not in step.remove_asset_ids:
                public["skipped"][identity] = "not_selected"
                continue
            row = await self.session.get(VisualAsset, identity, populate_existing=True)
            if not row or row.owner_user_id != self.owner or row.revision != item["revision"]:
                raise AssetError("素材在执行前已变化", code="dedupe_conflict", status=409)
            try:
                if self.audits.protect_asset:
                    await self.audits.protect_asset(identity)
                else:
                    await protect_references(self.session, [identity])
            except AssetError as exc:
                if exc.code != "asset_in_use":
                    raise
                public["skipped"][identity] = "asset_in_use"
                continue
            await self.session.delete(row)
            public["removed_ids"].append(identity)
        public["state"] = "cleaned"
        await self.audits.save(operation, version, document)
        await self.purge(group)
        return await self.audits.status(operation)

    async def purge(self, group):
        for item in group["originals"]:
            if item["id"] in group["public"]["removed_ids"]:
                path = original_path(self.files, item)
                await run_blocking_io(path.unlink, missing_ok=True)

    async def restore(self, operation, step):
        version, document = await self.audits.load(operation)
        group = self.audits.group(document, step.content_key)
        public = group["public"]
        if public["state"] == "restored":
            return await self.audits.status(operation)
        if public["state"] != "cleaned" or version != step.expected_revision:
            raise AssetError("去重操作已变化", code="dedupe_conflict", status=409)
        for project in document["project_ids"]:
            await self.files._project(project)
        original = await self.files._asset(public["canonical_id"])
        if original.owner_user_id != self.owner:
            raise AssetError("保留原件不可用", code="not_found", status=404)
        source_path = original_path(self.files, snapshot(original))
        await self.session.rollback()
        if "restore_files" not in group:
            group["restore_files"] = [
                {
                    **item,
                    "storage_key": uuid4().hex,
                    "storage_version": 2,
                    "revision": item["revision"] + 1,
                }
                for item in group["originals"]
                if item["id"] in public["removed_ids"]
            ]
            await self.audits.save(operation, version, document)
            version += 1
        for item in group["restore_files"]:
            temporary, target = self.files.storage.prepare_write(
                item["storage_key"],
                visual_project_id=item["project_id"],
                galgame_project_id=None,
                owner_user_id=self.owner,
            )
            await run_blocking_io(
                copy_original,
                source_path,
                temporary,
                target,
                item["byte_size"],
                step.content_key,
                self.owner,
                item["media_kind"],
            )
        await self.session.execute(text("BEGIN IMMEDIATE"))
        for item in group["restore_files"]:
            if await self.session.get(VisualAsset, item["id"]) is not None:
                raise AssetError(
                    "恢复标识已占用，停止覆盖", code="dedupe_restore_conflict", status=409
                )
            # In-flight cleanup only holds the OLD storage key. Restored bytes use a new key.
            self.session.add(restored_row(item))
        public["state"] = "restored"
        await self.audits.save(operation, version, document)
        return await self.audits.status(operation)
