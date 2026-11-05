"""Move and verify account-owned Director project and motion bytes."""

import asyncio
import hashlib
import json
import os
from pathlib import Path
from typing import Annotated
from uuid import UUID, uuid4, uuid5

from fastapi import HTTPException, Request
from fastapi import Path as RoutePath
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select, text

from app.apps.director_desk.files import MAX_FILE_BYTES
from app.apps.director_desk.models import DirectorDeskProject, DirectorDeskUserMotion
from app.apps.director_desk.motions import file_keys
from app.apps.director_desk.schemas import FILE_KEY
from fpl_runtime.migration_batches import BatchReceipt, MigrationAdmission
from fpl_runtime.migration_files import inspect_blob, publish_blob

from .migration_receipts import has_receipt, record_receipt
from .migration_records import ID
from .storage import APPLICATION, DirectorStorageSettings

FILES = "/v1/migration/director/files"
DATASET = "director.files"
FileScope = Annotated[str, RoutePath(pattern=rf"^(?:library|{ID[1:-1]})$")]
FileDigest = Annotated[str, RoutePath(pattern=FILE_KEY.pattern)]


class DirectorFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    scope: str = Field(pattern=rf"^(?:library|{ID[1:-1]})$")
    sha256: str = Field(pattern=FILE_KEY.pattern)
    size: int = Field(gt=0, le=MAX_FILE_BYTES)


def receipt_for(plan, owner, file):
    return BatchReceipt(
        run_id=plan.run_id,
        owner_id=owner,
        batch_id=uuid5(plan.run_id, f"{DATASET}/{owner}/{file.scope}/{file.sha256}"),
        dataset=DATASET,
        sha256=hashlib.sha256(
            json.dumps(file.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest(),
        record_count=1,
    )


def invalid_file():
    return HTTPException(409, {"code": "migration_director_file_conflict"})


def directory(path):
    if path.is_symlink() or (path.exists() and not path.is_dir()):
        raise ValueError("导演台文件目录无效")
    return path.iterdir() if path.exists() else iter(())


def measure(path, scope, digest):
    size, actual = inspect_blob(path, maximum=MAX_FILE_BYTES)
    if actual != digest:
        raise ValueError("导演台文件摘要不匹配")
    return DirectorFile(scope=scope, sha256=digest, size=size)


class DirectorFiles:
    def __init__(self, root, sessions):
        self.settings = DirectorStorageSettings(root)
        self.sessions = sessions

    def root(self, owner):
        return self.settings.checked_path("accounts", str(owner), "applications", APPLICATION)

    def blob(self, owner, scope, digest):
        parts = ("library",) if scope == "library" else ("projects", scope, "files")
        return self.settings.checked_path(
            "accounts", str(owner), "applications", APPLICATION, *parts, digest
        )

    async def references(self, owner):
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            projects = await db.execute(
                select(DirectorDeskProject.id, DirectorDeskProject.document).where(
                    DirectorDeskProject.owner_user_id == str(owner)
                )
            )
            resources = await db.scalars(
                select(DirectorDeskUserMotion.resource).where(
                    DirectorDeskUserMotion.owner_user_id == str(owner)
                )
            )
            scopes = {key: file_keys(document) for key, document in projects}
            scopes["library"] = {key for resource in resources for key in file_keys(resource)}
            return scopes

    def _inventory(self, owner, refs, *, complete):
        trash = self.settings.checked_path(".trash", str(owner), APPLICATION)
        if any(directory(trash)):
            raise ValueError("导演台暂存删除需要在原站恢复")
        root = self.root(owner)
        found = []
        for entry in directory(root):
            if entry.name not in {"projects", "library", ".uploads", ".migration"}:
                raise ValueError("导演台存在未登记的文件目录")
            if entry.name.startswith("."):
                directory(entry)
        for project in directory(root / "projects"):
            if project.name not in refs or project.name == "library":
                raise ValueError("导演台文件缺少项目归属")
            if any(item.name != "files" for item in directory(project)):
                raise ValueError("导演台项目存在未登记的文件目录")
        for scope, required in sorted(refs.items()):
            path = self.blob(owner, scope, "_placeholder").parent
            files = set()
            for item in sorted(directory(path)):
                if item.name == ".tmp":
                    directory(item)
                    continue
                if FILE_KEY.fullmatch(item.name) is None:
                    raise ValueError("导演台文件路径无效")
                found.append(measure(item, scope, item.name))
                files.add(item.name)
            if complete and required - files:
                raise ValueError("导演台引用文件缺失")
        return found

    def check_owners(self, allowed):
        for base in ("accounts", ".trash"):
            for owner in directory(self.settings.checked_path(base)):
                if owner.name in allowed:
                    continue
                path = (
                    owner / APPLICATION
                    if base == ".trash"
                    else owner / "applications" / APPLICATION
                )
                if path.exists() or path.is_symlink():
                    raise ValueError("导演台文件账号未登记")

    async def inventory(self, owner, *, complete):
        refs = await self.references(owner)
        try:
            return await asyncio.to_thread(self._inventory, owner, refs, complete=complete)
        except (OSError, ValueError):
            raise invalid_file() from None

    async def validate_scope(self, owner, scope):
        if scope == "library":
            return
        async with self.sessions(info={"owner_user_id": str(owner)}) as db:
            exists = await db.scalar(
                select(DirectorDeskProject.id).where(
                    DirectorDeskProject.id == scope, DirectorDeskProject.owner_user_id == str(owner)
                )
            )
        if exists is None:
            raise HTTPException(404, {"code": "migration_director_project_missing"})

    async def store(self, request, owner, scope, digest):
        await self.validate_scope(owner, scope)
        try:
            path = self.blob(owner, scope, digest)
            root = self.settings.checked_path(
                "accounts", str(owner), "applications", APPLICATION, ".migration"
            )
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            staged = root / f"{uuid4().hex}.part"
            try:
                actual = hashlib.sha256()
                size = 0
                with os.fdopen(
                    os.open(staged, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb"
                ) as stream:
                    async for incoming in request.stream():
                        size += len(incoming)
                        if size > MAX_FILE_BYTES:
                            raise HTTPException(413, {"code": "migration_director_file_too_large"})
                        actual.update(incoming)
                        await asyncio.to_thread(stream.write, incoming)
                    if actual.hexdigest() != digest or size == 0:
                        raise HTTPException(
                            422, {"code": "migration_director_file_digest_mismatch"}
                        )
                    stream.flush()
                    os.fsync(stream.fileno())
                return await asyncio.to_thread(
                    publish, self.settings.runtime_path, path, staged, scope, digest, size
                )
            finally:
                staged.unlink(missing_ok=True)
        except (OSError, ValueError):
            raise invalid_file() from None


def publish(root: Path, path: Path, staged, scope, digest, size):
    publish_blob(root, path, staged, size, digest)
    return DirectorFile(scope=scope, sha256=digest, size=size)


def mount_files(app, plan, sessions, *, root, source=None):
    admission = MigrationAdmission(plan)
    files = DirectorFiles(root, sessions)

    def check_source():
        if source is not None:
            try:
                source.check()
            except (ValueError, OSError):
                raise HTTPException(409, {"code": "migration_source_changed"}) from None

    @app.get(FILES)
    async def verify_owners():
        check_source()
        try:
            await asyncio.to_thread(files.check_owners, {str(owner) for owner in plan.owner_ids})
        except (OSError, ValueError):
            raise invalid_file() from None
        check_source()
        return {"verified": True}

    @app.get(f"{FILES}/{{owner}}", response_model=list[DirectorFile])
    async def list_files(owner: UUID, complete: bool = False):
        admission.check_owner(owner)
        check_source()
        result = await files.inventory(owner, complete=complete or source is not None)
        check_source()
        return result

    @app.get(f"{FILES}/{{owner}}/{{scope}}/{{digest}}")
    async def download(owner: UUID, scope: FileScope, digest: FileDigest):
        admission.check_owner(owner)
        check_source()
        await files.validate_scope(owner, scope)
        try:
            path = files.blob(owner, scope, digest)
            await asyncio.to_thread(measure, path, scope, digest)
        except (OSError, ValueError):
            raise invalid_file() from None
        check_source()
        return FileResponse(path, media_type="application/octet-stream")

    if source is None:

        @app.put(f"{FILES}/{{owner}}/{{scope}}/{{digest}}", response_model=BatchReceipt)
        async def import_file(owner: UUID, scope: FileScope, digest: FileDigest, request: Request):
            admission.check_owner(owner)
            file = await files.store(request, owner, scope, digest)
            receipt = receipt_for(plan, owner, file)
            async with sessions(info={"owner_user_id": str(owner)}) as db:
                await db.execute(text("BEGIN IMMEDIATE"))
                if not await has_receipt(db, receipt):
                    record_receipt(db, receipt)
                    await db.commit()
            return receipt
