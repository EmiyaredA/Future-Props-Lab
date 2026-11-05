"""Versioned, additive note archives; disk staging precedes database writes."""

from __future__ import annotations

import asyncio
import json
import shutil
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select

from studio.apps.asset_library.storage.file_paths import AssetStorage
from studio.apps.asset_library.storage.models import VisualAsset
from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.thought_workshop.archive_files import extract_archive, stage_archive
from studio.apps.thought_workshop.backup_manifest import collect_backup
from studio.apps.thought_workshop.notes import Notes, ThoughtError
from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from studio.apps.thought_workshop.website.archive_import import allocate_ids, persist_archive
from studio.config.settings import Settings
from studio.contracts.asset_library.file_types import ATTACHMENT_EXTENSIONS
from studio.contracts.asset_library.incoming import IncomingFile


async def export_backup(
    notes: Notes, settings: Settings, knowledge_base_id: str | None = None
) -> Path:
    payload, ids = await collect_backup(notes, knowledge_base_id)
    assets = (
        (
            await notes.session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.owner_user_id == notes.owner_user_id,
                )
            )
        ).all()
        if ids
        else []
    )
    if {r.id for r in assets} != ids:
        raise ThoughtError("备份引用的文件不存在")
    storage = AssetStorage(settings)
    sources = [(r.id, storage.path_for(r), r.original_filename, r.mime_type) for r in assets]
    payload["assets"] = [
        {"id": rid, "path": f"assets/{rid}", "filename": name, "content_type": mime}
        for rid, _, name, mime in sources
    ]
    await notes.session.rollback()

    def write():
        root = Path(tempfile.mkdtemp(prefix="thought-export-"))
        target = root / "thought-workshop.zip"
        try:
            data = json.dumps(payload, ensure_ascii=False).encode()
            if (
                len(data) > 32 * 1024 * 1024
                or len(sources) + 1 > settings.fpl_project_snapshot_max_files
            ):
                raise ThoughtError("笔记集合超过备份上限", 413)
            if (
                len(data) + sum(path.stat().st_size for _, path, _, _ in sources)
                > settings.fpl_project_snapshot_max_bytes
            ):
                raise ThoughtError("备份超过大小限制", 413)
            with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                archive.writestr("manifest.json", data)
                for rid, path, _, _ in sources:
                    archive.write(path, f"assets/{rid}")
            return target
        except BaseException:
            shutil.rmtree(root, ignore_errors=True)
            raise

    return await asyncio.to_thread(write)


async def import_backup(
    notes: Notes,
    settings: Settings,
    upload: IncomingFile,
    knowledge_base_id: str | None = None,
    expected_revision: int | None = None,
    *,
    before_write=None,
    before_commit=None,
) -> ThoughtImportOut:
    root = Path(tempfile.mkdtemp(prefix="thought-import-"))
    files: list[Path] = []
    try:
        path = await stage_archive(
            upload, root, maximum_bytes=settings.fpl_project_snapshot_max_bytes
        )
        payload, parsed = await asyncio.to_thread(
            extract_archive,
            path,
            root,
            maximum_files=settings.fpl_project_snapshot_max_files,
            maximum_bytes=settings.fpl_project_snapshot_max_bytes,
            maximum_asset_bytes=settings.fpl_visual_asset_max_bytes,
        )
        await notes.session.rollback()
        mapping: dict[str, str] = {}
        library = AssetLibrary(notes.session, settings)
        # Deferred staging validates and copies all files before any database write.
        staged_rows = []
        with notes.session.no_autoflush:
            for asset in payload["assets"]:
                row, final_path = await library.stage_local_copy(
                    Path(asset["staged_path"]),
                    owner_user_id=notes.owner_user_id,
                    filename=asset["filename"],
                    content_type=asset["content_type"],
                    allowed_extensions={".png", ".jpg", ".jpeg", ".webp", ".gif"}
                    | ATTACHMENT_EXTENSIONS,
                    defer_persistence=True,
                )
                row.id = str(uuid4())
                staged_rows.append(row)
                files.append(final_path)
                mapping[asset["id"]] = row.id
        if before_write:
            replay = await before_write(notes.session)
            if replay is not None:
                return replay
        notes.session.add_all(staged_rows)
        await notes.session.flush()
        output, note_mapping, project_mapping = await persist_archive(
            notes,
            payload,
            parsed,
            mapping,
            allocate_ids(payload),
            knowledge_base_id,
            expected_revision,
        )
        if before_commit:
            await before_commit(notes.session, note_mapping, project_mapping, output)
        await notes.session.commit()
        files.clear()
        return output
    except (KeyError, TypeError, ValueError, zipfile.BadZipFile, ValidationError) as exc:
        await notes.session.rollback()
        raise ThoughtError("备份内容无效或不完整") from exc
    except BaseException:
        await notes.session.rollback()
        raise
    finally:
        await upload.close()
        for file in files:
            file.unlink(missing_ok=True)
        shutil.rmtree(root, ignore_errors=True)
