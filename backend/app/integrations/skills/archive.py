from __future__ import annotations

import hashlib
import os
import shutil
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from uuid import uuid4

import yaml

from app.capabilities.asset_store.incoming import IncomingFile
from app.integrations.common import IntegrationValidationError
from app.runtime.config import Settings

SKILL_MD_MAX_BYTES = 256 * 1024


@dataclass(frozen=True)
class StagedSkillArchive:
    directory: Path
    name: str
    description: str
    sha256: str
    file_count: int
    expanded_bytes: int


class SkillArchiveStorage:
    def __init__(self, settings: Settings, workspace_id: str) -> None:
        self.settings = settings
        self.root = settings.workspace_skill_path(workspace_id)

    async def stage(self, upload: IncomingFile) -> StagedSkillArchive:
        self.root.mkdir(parents=True, exist_ok=True)
        nonce = uuid4().hex
        archive_path = self.root / f".upload-{nonce}.zip"
        stage_dir = self.root / f".staging-{nonce}"
        digest = hashlib.sha256()
        size = 0
        try:
            with archive_path.open("xb") as destination:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > self.settings.fpl_skill_archive_max_bytes:
                        raise IntegrationValidationError("Skill ZIP 超过 10 MiB 限制")
                    digest.update(chunk)
                    destination.write(chunk)
            return self._extract(archive_path, stage_dir, digest.hexdigest())
        except (zipfile.BadZipFile, RuntimeError, NotImplementedError) as exc:
            shutil.rmtree(stage_dir, ignore_errors=True)
            raise IntegrationValidationError("上传文件不是可读取的安全 ZIP") from exc
        except Exception:
            shutil.rmtree(stage_dir, ignore_errors=True)
            raise
        finally:
            archive_path.unlink(missing_ok=True)
            await upload.close()

    def _extract(self, archive_path: Path, stage_dir: Path, digest: str) -> StagedSkillArchive:
        try:
            archive = zipfile.ZipFile(archive_path)
        except (zipfile.BadZipFile, OSError) as exc:
            raise IntegrationValidationError("上传文件不是有效 ZIP") from exc
        with archive:
            files = [item for item in archive.infolist() if not item.is_dir()]
            if not files or len(files) > self.settings.fpl_skill_max_files:
                raise IntegrationValidationError("Skill 文件数量必须在 1 到 500 之间")
            expanded = sum(item.file_size for item in files)
            if expanded > self.settings.fpl_skill_expanded_max_bytes:
                raise IntegrationValidationError("Skill 解压后超过 50 MiB 限制")
            prefix = self._root_prefix(files)
            normalized: dict[str, zipfile.ZipInfo] = {}
            for item in files:
                self._validate_member(item)
                name = PurePosixPath(item.filename).as_posix()
                relative = name[len(prefix) :] if prefix else name
                target = PurePosixPath(relative)
                if not relative or target.is_absolute() or ".." in target.parts:
                    raise IntegrationValidationError("Skill ZIP 包含不安全路径")
                key = relative.casefold()
                if key in normalized:
                    raise IntegrationValidationError("Skill ZIP 包含重复路径")
                normalized[key] = item
            skill_info = normalized.get("skill.md")
            if skill_info is None:
                raise IntegrationValidationError("Skill ZIP 根目录缺少 SKILL.md")
            if skill_info.file_size > SKILL_MD_MAX_BYTES:
                raise IntegrationValidationError("SKILL.md 超过 256 KiB 限制")
            name, description = self._metadata(archive.read(skill_info))
            stage_dir.mkdir(mode=0o700)
            for item in normalized.values():
                relative = PurePosixPath(item.filename).as_posix()
                relative = relative[len(prefix) :] if prefix else relative
                destination = stage_dir.joinpath(*PurePosixPath(relative).parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(item) as source, destination.open("xb") as target:
                    shutil.copyfileobj(source, target, length=1024 * 1024)
            return StagedSkillArchive(
                directory=stage_dir,
                name=name,
                description=description,
                sha256=digest,
                file_count=len(files),
                expanded_bytes=expanded,
            )

    @staticmethod
    def _root_prefix(files: list[zipfile.ZipInfo]) -> str:
        names = [PurePosixPath(item.filename).as_posix() for item in files]
        if "SKILL.md" in names:
            return ""
        roots = {PurePosixPath(name).parts[0] for name in names if PurePosixPath(name).parts}
        if len(roots) != 1:
            return ""
        prefix = f"{next(iter(roots))}/"
        return prefix if f"{prefix}SKILL.md" in names else ""

    @staticmethod
    def _validate_member(item: zipfile.ZipInfo) -> None:
        path = PurePosixPath(item.filename)
        mode = item.external_attr >> 16
        if (
            path.is_absolute()
            or ".." in path.parts
            or "\\" in item.filename
            or (path.parts and path.parts[0].endswith(":"))
            or "\x00" in item.filename
            or (mode and stat.S_ISLNK(mode))
        ):
            raise IntegrationValidationError("Skill ZIP 包含不安全文件")

    @staticmethod
    def _metadata(content: bytes) -> tuple[str, str]:
        try:
            text = content.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise IntegrationValidationError("SKILL.md 必须使用 UTF-8") from exc
        lines = text.splitlines()
        if not lines or lines[0].strip() != "---":
            raise IntegrationValidationError("SKILL.md 缺少 YAML frontmatter")
        try:
            closing = next(
                index for index, line in enumerate(lines[1:], 1) if line.strip() == "---"
            )
        except StopIteration as exc:
            raise IntegrationValidationError("SKILL.md frontmatter 未闭合") from exc
        try:
            metadata = yaml.safe_load("\n".join(lines[1:closing])) or {}
        except yaml.YAMLError as exc:
            raise IntegrationValidationError("SKILL.md frontmatter 无效") from exc
        if not isinstance(metadata, dict):
            raise IntegrationValidationError("SKILL.md frontmatter 必须是对象")
        raw_name = metadata.get("name")
        raw_description = metadata.get("description")
        if not isinstance(raw_name, str) or not isinstance(raw_description, str):
            raise IntegrationValidationError("SKILL.md 的 name 和 description 必须是文本")
        name = raw_name.strip()
        description = raw_description.strip()
        if not 1 <= len(name) <= 120 or not 1 <= len(description) <= 1000:
            raise IntegrationValidationError("SKILL.md 必须包含有效的 name 和 description")
        return name, description

    def final_path(self, skill_id: str, version: str) -> Path:
        return (self.root / skill_id / version).resolve()

    def place(self, staged: StagedSkillArchive, skill_id: str, version: str) -> Path:
        destination = self.final_path(skill_id, version)
        destination.parent.mkdir(parents=True, exist_ok=True)
        if destination.exists():
            raise IntegrationValidationError("Skill 版本目录已存在")
        os.replace(staged.directory, destination)
        return destination

    def stage_delete(self, skill_id: str) -> tuple[Path, Path] | None:
        source = (self.root / skill_id).resolve()
        if not source.exists():
            return None
        trash = self.settings.storage_trash_path / "integrations"
        trash.mkdir(parents=True, exist_ok=True)
        staged = trash / f"{skill_id}--trash--{uuid4().hex}"
        os.replace(source, staged)
        return source, staged

    @staticmethod
    def restore_delete(staged: tuple[Path, Path] | None) -> None:
        if staged and staged[1].exists():
            staged[0].parent.mkdir(parents=True, exist_ok=True)
            os.replace(staged[1], staged[0])

    @staticmethod
    def purge_delete(staged: tuple[Path, Path] | None) -> None:
        if staged:
            shutil.rmtree(staged[1], ignore_errors=True)
