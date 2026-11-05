"""Portable motion projects with validated asset remapping."""

from __future__ import annotations

import json
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.capabilities.asset_store.library import AssetLibrary
from app.capabilities.asset_store.models import VisualAsset
from app.capabilities.asset_store.storage import AssetStorage
from studio.apps.motion_compositor.projects import MotionInvalid, MotionProjects
from studio.apps.motion_compositor.schemas import OperationBatchIn, ProjectCreateIn, ProjectOut
from studio.apps.motion_compositor.snapshot_format import (
    FORMAT,
    MAX_ARCHIVE_BYTES,
    archive_asset,
    archive_manifest,
)
from studio.config.settings import get_settings
from studio.contracts.asset_library.incoming import IncomingFile
from studio.contracts.motion_compositor.document import MotionComposition


class MotionSnapshots:
    def __init__(self, session: AsyncSession, owner_user_id: str) -> None:
        self.session = session
        self.owner_user_id = owner_user_id
        self.projects = MotionProjects(session, owner_user_id)
        self.settings = get_settings()
        self.storage = AssetStorage(self.settings)
        self.library = AssetLibrary(session, self.settings)

    async def export(self, project_id: str) -> Path:
        project = await self.projects.row(project_id)
        document = await self.projects.document(project_id)
        assets = list(
            (
                await self.session.execute(
                    select(VisualAsset).where(
                        VisualAsset.motion_compositor_project_id == project_id,
                        VisualAsset.owner_user_id == self.owner_user_id,
                    )
                )
            ).scalars()
        )
        target = Path(tempfile.gettempdir()) / f"motion-{uuid4().hex}.zip"
        entries = [archive_asset(asset) for asset in assets]
        manifest = archive_manifest(project.title, document.document, entries)
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for asset, entry in zip(assets, entries, strict=True):
                archive.write(self.storage.path_for(asset), entry["name"])
            archive.writestr("manifest.json", json.dumps(manifest, ensure_ascii=False))
        return target

    async def import_snapshot(self, upload: IncomingFile) -> ProjectOut:
        temporary = Path(tempfile.gettempdir()) / f"motion-import-{uuid4().hex}.zip"
        created: ProjectOut | None = None
        try:
            size = 0
            with temporary.open("xb") as target:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_ARCHIVE_BYTES:
                        raise MotionInvalid("工程包超过大小限制")
                    target.write(chunk)
            with zipfile.ZipFile(temporary) as archive:
                members = {info.filename: info for info in archive.infolist()}
                if "manifest.json" not in members or members["manifest.json"].file_size > 5_000_000:
                    raise MotionInvalid("工程包缺少有效清单")
                manifest = json.loads(archive.read("manifest.json"))
                if manifest.get("format") != FORMAT:
                    raise MotionInvalid("不支持此工程包版本")
                entries = manifest.get("assets", [])
                if not isinstance(entries, list) or len(entries) > 500:
                    raise MotionInvalid("工程包素材清单无效")
                names = [entry.get("name") for entry in entries]
                if len(set(names)) != len(names) or set(members) != {"manifest.json", *names}:
                    raise MotionInvalid("工程包包含未登记文件")
                if sum(info.file_size for info in members.values()) > MAX_ARCHIVE_BYTES * 2:
                    raise MotionInvalid("工程包解压后超过大小限制")
                document = MotionComposition.model_validate(manifest["document"])
                settings = document.settings
                aspect = (
                    "16:9"
                    if settings.width > settings.height
                    else "9:16"
                    if settings.height > settings.width
                    else "1:1"
                )
                created = await self.projects.create(
                    ProjectCreateIn(title=manifest["title"], aspect=aspect, fps=settings.fps)
                )
                mapping: dict[str, str] = {}
                project_root = self.storage.project_root(
                    "motion-compositor", created.id, owner_user_id=self.owner_user_id
                )
                staged: list[Path] = []
                try:
                    for entry in entries:
                        old_id = str(entry["id"])
                        name = str(entry["name"])
                        if (
                            name not in members
                            or not name.startswith(f"assets/{old_id}")
                            or Path(name).name != name.split("/")[-1]
                        ):
                            raise MotionInvalid("工程包素材路径无效")
                        extracted = project_root / f".import-{uuid4().hex}{Path(name).suffix}"
                        with archive.open(name) as source, extracted.open("xb") as destination:
                            while chunk := source.read(1024 * 1024):
                                destination.write(chunk)
                        try:
                            row, stored = await self.library.stage_local_copy(
                                extracted,
                                owner_user_id=self.owner_user_id,
                                filename=str(entry["filename"]),
                                content_type=str(entry["mimeType"]),
                                motion_compositor_project_id=created.id,
                            )
                            staged.append(stored)
                            mapping[old_id] = row.id
                        finally:
                            extracted.unlink(missing_ok=True)
                    await self.session.commit()
                except Exception:
                    await self.session.rollback()
                    for path in staged:
                        path.unlink(missing_ok=True)
                    raise
                payload = document.model_dump(mode="json", by_alias=True)
                for layer in payload["layers"]:
                    if layer.get("assetId"):
                        if layer["assetId"] not in mapping:
                            raise MotionInvalid("工程包缺少图层素材")
                        layer["assetId"] = mapping[layer["assetId"]]
                await self.projects.apply(
                    created.id,
                    OperationBatchIn.model_validate(
                        {
                            "expectedRevision": 0,
                            "requestId": f"snapshot-{uuid4().hex}",
                            "operations": [{"type": "replaceDocument", "document": payload}],
                        }
                    ),
                )
                return created
        except Exception:
            if created is not None:
                await self.projects.delete(created.id, created.revision)
            raise
        finally:
            temporary.unlink(missing_ok=True)
            await upload.close()
