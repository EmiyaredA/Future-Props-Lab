"""Versioned, additive note archives; disk staging precedes database writes."""

from __future__ import annotations

import asyncio
import shutil
import tempfile
import zipfile
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError

from studio.apps.asset_library.storage.uploads import AssetLibrary
from studio.apps.thought_workshop.archive_files import extract_archive, stage_archive
from studio.apps.thought_workshop.notes import Notes, ThoughtError
from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from studio.apps.thought_workshop.website.archive_import import allocate_ids, persist_archive
from studio.config.settings import Settings
from studio.contracts.asset_library.file_types import ATTACHMENT_EXTENSIONS
from studio.contracts.asset_library.incoming import IncomingFile


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
