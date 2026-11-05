"""Prepare immutable archives of one enabled Skill owned by the requesting account."""

import hashlib
import stat
from dataclasses import dataclass
from functools import partial
from tempfile import TemporaryFile
from typing import BinaryIO
from zipfile import ZIP_DEFLATED, ZipFile

from anyio.to_thread import run_sync

from app.integrations.skills.archive import SkillArchiveStorage
from app.integrations.skills.catalog import SkillCatalog
from app.runtime.operation_receipts import OperationError
from fpl_runtime.amadeus_skills import SkillPin


@dataclass(frozen=True)
class Archive:
    file: BinaryIO
    pin: SkillPin


def pack(root, output, *, storage, name, version):
    if root.is_symlink() or root.resolve() != root or not root.is_dir():
        raise ValueError("Skill 文件目录无效")
    seen = set()
    total = 0
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        for path in sorted(root.rglob("*")):
            relative = path.relative_to(root).as_posix()
            if path.is_symlink() or "\\" in relative:
                raise ValueError("Skill 文件路径无效")
            if path.is_dir():
                continue
            metadata = path.stat(follow_symlinks=False)
            if not stat.S_ISREG(metadata.st_mode) or relative.casefold() in seen:
                raise ValueError("Skill 文件无效")
            seen.add(relative.casefold())
            total += metadata.st_size
            if (
                len(seen) > storage.limits.fpl_skill_max_files
                or total > storage.limits.fpl_skill_expanded_max_bytes
            ):
                raise ValueError("Skill 文件超出限制")
            archive.write(path, relative)
    archive_bytes = output.tell()
    output.seek(0)
    checksum = hashlib.file_digest(output, "sha256").hexdigest()
    output.seek(0)
    return SkillPin(
        name=name,
        version=version,
        file_count=len(seen),
        expanded_bytes=total,
        archive_bytes=archive_bytes,
        archive_sha256=checksum,
    )


async def snapshot(database, settings, owner, skill_id, *, include_archive):
    storage = SkillArchiveStorage(settings, owner)
    async with database.sessions(info={"owner_user_id": owner}) as session:
        catalog = SkillCatalog(session, owner, storage=storage)
        skill = await catalog.get(skill_id)
        if not skill.enabled:
            raise OperationError("Skill 尚未启用", "skill_unavailable", 409)
        if not include_archive:
            return {"name": skill.name}
        version = skill.default_version or skill.latest_version
        versions = await catalog.versions(skill_id)
        if version not in {item.version for item in versions}:
            raise OperationError("Skill 版本不可用", "skill_unavailable", 409)
        root = storage.root / skill_id / version
        await session.rollback()
        output = TemporaryFile(dir=settings.runtime_path)
        try:
            pin = await run_sync(
                partial(pack, root, output, storage=storage, name=skill.name, version=version)
            )
            if (await catalog.get(skill_id)).revision != skill.revision:
                raise OperationError("Skill 已更新，请重新加载", "skill_unavailable", 409)
        except BaseException:
            output.close()
            raise
    return Archive(output, pin)
