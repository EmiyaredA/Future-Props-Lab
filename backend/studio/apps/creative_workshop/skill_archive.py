"""Create reproducible Skill ZIPs from the owning Creative release files."""

import asyncio
import hashlib
import os
import stat
import tempfile
import zipfile
from contextlib import asynccontextmanager
from pathlib import Path

from studio.contracts.creative_workshop.creative_integrations import CreativeSkillBlob
from studio.runtime.files.skill_tree import skill_tree_sha256

from .skill_integrity import published_skill_path


class SkillArchivePacker:
    def __init__(
        self, *, root: Path, max_files: int, max_expanded_bytes: int, max_archive_bytes: int
    ):
        if any(
            type(value) is not int or value < 1
            for value in (max_files, max_expanded_bytes, max_archive_bytes)
        ):
            raise ValueError("Skill 归档限制无效")
        self.root = Path(root).resolve()
        self.max_files, self.max_expanded_bytes, self.max_archive_bytes = (
            max_files,
            max_expanded_bytes,
            max_archive_bytes,
        )

    def _pack(self, owner, release_id, relative):
        source = published_skill_path(self.root, owner, release_id, relative)
        tree = skill_tree_sha256(
            source, max_files=self.max_files, max_bytes=self.max_expanded_bytes
        )
        staging = self.root / ".creative-archive-staging"
        if staging.is_symlink():
            raise ValueError("Skill 归档暂存目录不能是符号链接")
        staging.mkdir(mode=0o700, exist_ok=True)
        info = staging.stat()
        if info.st_uid != os.getuid() or stat.S_IMODE(info.st_mode) & 0o077:
            raise ValueError("Skill 归档暂存目录必须私有")
        output = tempfile.TemporaryFile(mode="w+b", dir=staging)
        try:
            entries = []

            def error(exc):
                raise exc

            for directory, dirs, files in os.walk(source, followlinks=False, onerror=error):
                for name in dirs:
                    if (Path(directory) / name).is_symlink():
                        raise ValueError("Skill 目录不能包含符号链接")
                for name in files:
                    path = Path(directory) / name
                    entries.append((path.relative_to(source).as_posix(), path))
            if not entries or len(entries) > self.max_files:
                raise ValueError("Skill 文件数量无效")
            expanded = 0
            with zipfile.ZipFile(output, "w", allowZip64=True) as archive:
                for name, path in sorted(entries, key=lambda value: value[0].encode("utf-8")):
                    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                    with os.fdopen(descriptor, "rb") as incoming:
                        before = os.fstat(incoming.fileno())
                        if not stat.S_ISREG(before.st_mode):
                            raise ValueError("Skill 只能包含普通文件")
                        expanded += before.st_size
                        if expanded > self.max_expanded_bytes:
                            raise ValueError("Skill 文件大小超限")
                        entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                        entry.create_system = 3
                        entry.external_attr = 0o100644 << 16
                        entry.compress_type = zipfile.ZIP_STORED
                        with archive.open(entry, "w", force_zip64=True) as outgoing:
                            while chunk := incoming.read(1024 * 1024):
                                outgoing.write(chunk)
                                if output.tell() > self.max_archive_bytes:
                                    raise ValueError("Skill 归档大小超限")
                        after = os.fstat(incoming.fileno())
                        if (before.st_size, before.st_mtime_ns, before.st_ino) != (
                            after.st_size,
                            after.st_mtime_ns,
                            after.st_ino,
                        ):
                            raise ValueError("Skill 文件读取时发生变化")
            size = output.tell()
            if size > self.max_archive_bytes:
                raise ValueError("Skill 归档大小超限")
            if (
                skill_tree_sha256(
                    source, max_files=self.max_files, max_bytes=self.max_expanded_bytes
                )
                != tree
            ):
                raise ValueError("Skill 文件读取时发生变化")
            output.seek(0)
            digest = hashlib.file_digest(output, "sha256").hexdigest()
            output.seek(0)
            return output, CreativeSkillBlob(
                sha256=digest,
                tree_sha256=tree,
                byte_size=size,
                file_count=len(entries),
                expanded_bytes=expanded,
            )
        except BaseException:
            output.close()
            raise

    @asynccontextmanager
    async def open_release(self, owner, release_id, relative):
        task = asyncio.create_task(asyncio.to_thread(self._pack, owner, release_id, relative))
        try:
            output, description = await asyncio.shield(task)
        except asyncio.CancelledError:

            def close_when_finished(done):
                try:
                    output, _description = done.result()
                except BaseException:
                    return
                output.close()

            task.add_done_callback(close_when_finished)
            raise
        try:
            yield output, description
        finally:
            output.close()


class CreativeSkillArchives:
    def __init__(self, database, packer: SkillArchivePacker):
        self.database, self.packer = database, packer

    @asynccontextmanager
    async def open(self, batch):
        from contextlib import AsyncExitStack

        from .install_batch import published_parts
        from .installation_outbox import InstallIntentConflict

        parts = {part.release_id: part for part in batch.parts if part.kind == "skill"}
        sources = {
            part.release_id: part
            for part in await published_parts(self.database, batch.root_release_id)
        }
        if not set(parts) <= sources.keys():
            raise InstallIntentConflict("Skill 来源与安装批次不匹配")
        async with AsyncExitStack() as stack:
            files = {}
            for release_id, part in parts.items():
                source = sources[release_id]
                if source.kind != "skill":
                    raise InstallIntentConflict("Skill 来源与安装批次不匹配")
                stream, description = await stack.enter_async_context(
                    self.packer.open_release(source.owner, source.release_id, source.skill_path)
                )
                if description != part.skill:
                    raise InstallIntentConflict("Skill 归档与安装批次不匹配")
                files[release_id] = ("skill.zip", stream, "application/zip")
            yield files
