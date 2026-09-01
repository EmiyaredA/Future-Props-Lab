from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import stat
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from uuid import uuid4

from pydantic import ValidationError

from app.core.config import Settings
from app.core.time import iso_utc, utc_now
from app.files.incoming import IncomingFile
from app.schemas.project_snapshots import (
    ProjectSnapshotAssetManifest,
    ProjectSnapshotManifest,
)

FORMAT_NAME = "future-props-project-snapshot"
FORMAT_VERSION = 1
JSON_MAX_BYTES = 10 * 1024 * 1024


class ProjectSnapshotError(Exception):
    def __init__(self, message: str, *, code: str = "invalid_project_snapshot", status: int = 422):
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True)
class SnapshotAssetSource:
    source_id: str
    path: Path


@dataclass(frozen=True)
class ExportedProjectSnapshot:
    path: Path
    filename: str


@dataclass(frozen=True)
class StagedProjectSnapshot:
    directory: Path
    manifest: ProjectSnapshotManifest
    project: dict

    def asset_path(self, source_id: str) -> Path:
        item = next((asset for asset in self.manifest.assets if asset.source_id == source_id), None)
        if item is None:
            raise ProjectSnapshotError("快照引用了未声明的素材")
        return self.directory.joinpath(*PurePosixPath(item.path).parts)

    def cleanup(self) -> None:
        shutil.rmtree(self.directory, ignore_errors=True)


def _safe_download_name(title: str, application_id: str) -> str:
    cleaned = "".join("_" if char in '\\/:*?"<>|' or ord(char) < 32 else char for char in title)
    cleaned = cleaned.strip(" .") or "project"
    return f"{cleaned[:80]}-{application_id}-snapshot.zip"


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
        raise ProjectSnapshotError("项目快照包含不安全路径")


def cleanup_snapshot_staging(settings: Settings) -> None:
    """清理上次进程中断遗留的快照临时包和隔离目录。"""
    shutil.rmtree(settings.runtime_path / ".tmp" / "project-snapshots", ignore_errors=True)


def _write_json(archive: zipfile.ZipFile, name: str, value: object) -> None:
    archive.writestr(
        name,
        json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
        compress_type=zipfile.ZIP_DEFLATED,
    )


def _write_export(
    destination: Path,
    *,
    settings: Settings,
    application_id: str,
    source_project: dict,
    project: dict,
    assets: list[SnapshotAssetSource],
) -> None:
    project_bytes = json.dumps(project, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(project_bytes) > JSON_MAX_BYTES:
        raise ProjectSnapshotError(
            "项目结构超过 10 MiB 限制", code="snapshot_too_large", status=413
        )
    declared_bytes = len(project_bytes) + sum(
        source.path.stat().st_size if source.path.is_file() else 0 for source in assets
    )
    if declared_bytes > settings.fpl_project_snapshot_max_bytes:
        raise ProjectSnapshotError("项目快照超过大小限制", code="snapshot_too_large", status=413)
    if len(assets) + 2 > settings.fpl_project_snapshot_max_files:
        raise ProjectSnapshotError(
            "项目快照文件数量超过限制", code="snapshot_too_many_files", status=413
        )
    free = shutil.disk_usage(destination.parent).free
    if free < declared_bytes:
        raise ProjectSnapshotError(
            "磁盘空间不足，无法生成项目快照", code="snapshot_disk_full", status=507
        )

    manifest_assets: list[ProjectSnapshotAssetManifest] = []
    with zipfile.ZipFile(destination, "x", allowZip64=True) as archive:
        archive.writestr("project.json", project_bytes, compress_type=zipfile.ZIP_DEFLATED)
        for index, source in enumerate(assets, 1):
            if not source.path.is_file():
                raise ProjectSnapshotError(
                    "项目素材文件不存在，无法生成完整快照",
                    code="snapshot_source_missing",
                    status=409,
                )
            suffix = source.path.suffix.lower()[:16]
            member_name = f"assets/{index:06d}{suffix}"
            digest = hashlib.sha256()
            size = 0
            expected_size = source.path.stat().st_size
            with (
                source.path.open("rb") as input_file,
                archive.open(member_name, "w", force_zip64=True) as output,
            ):
                while chunk := input_file.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
                    output.write(chunk)
            if size != expected_size:
                raise ProjectSnapshotError(
                    "项目素材在导出过程中发生变化，请重试",
                    code="snapshot_source_changed",
                    status=409,
                )
            manifest_assets.append(
                ProjectSnapshotAssetManifest(
                    source_id=source.source_id,
                    path=member_name,
                    byte_size=size,
                    sha256=digest.hexdigest(),
                )
            )
        manifest = ProjectSnapshotManifest(
            format=FORMAT_NAME,
            format_version=FORMAT_VERSION,
            application_id=application_id,
            exported_at=iso_utc(utc_now()),
            source_project=source_project,
            project_byte_size=len(project_bytes),
            project_sha256=hashlib.sha256(project_bytes).hexdigest(),
            assets=manifest_assets,
        )
        _write_json(archive, "manifest.json", manifest.model_dump(mode="json"))


async def export_project_snapshot(
    settings: Settings,
    *,
    application_id: str,
    title: str,
    source_project: dict,
    project: dict,
    assets: list[SnapshotAssetSource],
) -> ExportedProjectSnapshot:
    root = settings.runtime_path / ".tmp" / "project-snapshots"
    root.mkdir(parents=True, exist_ok=True)
    path = root / f"export-{uuid4().hex}.zip"
    try:
        await asyncio.to_thread(
            _write_export,
            path,
            settings=settings,
            application_id=application_id,
            source_project=source_project,
            project=project,
            assets=assets,
        )
    except BaseException:
        path.unlink(missing_ok=True)
        raise
    return ExportedProjectSnapshot(path=path, filename=_safe_download_name(title, application_id))


def _read_json(archive: zipfile.ZipFile, item: zipfile.ZipInfo, label: str) -> dict:
    if item.file_size > JSON_MAX_BYTES:
        raise ProjectSnapshotError(
            f"{label} 超过 10 MiB 限制", code="snapshot_too_large", status=413
        )
    try:
        value = json.loads(archive.read(item).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ProjectSnapshotError(f"{label} 不是有效的 UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ProjectSnapshotError(f"{label} 必须是 JSON 对象")
    return value


def _extract_validated(
    archive_path: Path, stage_dir: Path, settings: Settings, expected_application: str
) -> StagedProjectSnapshot:
    try:
        archive = zipfile.ZipFile(archive_path)
    except (zipfile.BadZipFile, OSError) as exc:
        raise ProjectSnapshotError("上传文件不是有效 ZIP") from exc
    with archive:
        entries = archive.infolist()
        for item in entries:
            _validate_member(item)
        files = [item for item in entries if not item.is_dir()]
        if not files or len(entries) > settings.fpl_project_snapshot_max_files:
            raise ProjectSnapshotError(
                "项目快照文件数量超过限制", code="snapshot_too_many_files", status=413
            )
        expanded = sum(item.file_size for item in files)
        if expanded > settings.fpl_project_snapshot_max_bytes:
            raise ProjectSnapshotError(
                "项目快照展开后超过大小限制", code="snapshot_too_large", status=413
            )
        normalized: dict[str, zipfile.ZipInfo] = {}
        for item in files:
            name = PurePosixPath(item.filename).as_posix()
            key = name.casefold()
            if key in normalized:
                raise ProjectSnapshotError("项目快照包含重复路径")
            normalized[key] = item
        manifest_item = normalized.get("manifest.json")
        project_item = normalized.get("project.json")
        if manifest_item is None or project_item is None:
            raise ProjectSnapshotError("项目快照缺少 manifest.json 或 project.json")
        try:
            manifest = ProjectSnapshotManifest.model_validate(
                _read_json(archive, manifest_item, "manifest.json")
            )
        except ValidationError as exc:
            raise ProjectSnapshotError("manifest.json 不是受支持的项目快照清单") from exc
        if manifest.application_id != expected_application:
            raise ProjectSnapshotError(
                "项目快照属于其他 AI 应用", code="snapshot_application_mismatch"
            )
        expected = {
            "manifest.json",
            "project.json",
            *(item.path.casefold() for item in manifest.assets),
        }
        if set(normalized) != expected:
            raise ProjectSnapshotError("项目快照包含未声明文件或缺少声明文件")
        project_bytes = archive.read(project_item)
        if (
            len(project_bytes) != manifest.project_byte_size
            or hashlib.sha256(project_bytes).hexdigest() != manifest.project_sha256
        ):
            raise ProjectSnapshotError("项目结构完整性校验失败")
        project = _read_json(archive, project_item, "project.json")
        stage_dir.mkdir(mode=0o700)
        for asset in manifest.assets:
            item = normalized[asset.path.casefold()]
            if item.file_size != asset.byte_size:
                raise ProjectSnapshotError("项目快照素材大小与清单不一致")
            destination = stage_dir.joinpath(*PurePosixPath(asset.path).parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            digest = hashlib.sha256()
            size = 0
            with archive.open(item) as source, destination.open("xb") as target:
                while chunk := source.read(1024 * 1024):
                    size += len(chunk)
                    digest.update(chunk)
                    target.write(chunk)
            if size != asset.byte_size or digest.hexdigest() != asset.sha256:
                raise ProjectSnapshotError("项目快照素材完整性校验失败")
        return StagedProjectSnapshot(directory=stage_dir, manifest=manifest, project=project)


async def stage_project_snapshot(
    settings: Settings, upload: IncomingFile, *, expected_application: str
) -> StagedProjectSnapshot:
    root = settings.runtime_path / ".tmp" / "project-snapshots"
    root.mkdir(parents=True, exist_ok=True)
    nonce = uuid4().hex
    archive_path = root / f"upload-{nonce}.zip"
    stage_dir = root / f"stage-{nonce}"
    size = 0
    try:
        with archive_path.open("xb") as destination:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.fpl_project_snapshot_max_bytes:
                    raise ProjectSnapshotError(
                        "项目快照超过上传大小限制", code="snapshot_too_large", status=413
                    )
                destination.write(chunk)
        try:
            return await asyncio.to_thread(
                _extract_validated, archive_path, stage_dir, settings, expected_application
            )
        except (NotImplementedError, RuntimeError, zipfile.LargeZipFile) as exc:
            raise ProjectSnapshotError("项目快照使用了不支持的 ZIP 功能") from exc
    except BaseException:
        shutil.rmtree(stage_dir, ignore_errors=True)
        raise
    finally:
        archive_path.unlink(missing_ok=True)
        await upload.close()


def move_staged_asset(source: Path, destination: Path, *, expected_size: int) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or not source.is_file() or source.stat().st_size != expected_size:
        raise ProjectSnapshotError(
            "快照素材无法写入新项目", code="snapshot_storage_failed", status=500
        )
    os.replace(source, destination)
