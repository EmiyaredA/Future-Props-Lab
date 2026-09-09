"""Versioned, additive note archives; disk staging precedes database writes."""

from __future__ import annotations

import asyncio
import copy
import json
import shutil
import tempfile
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

from pydantic import ValidationError
from sqlalchemy import select

from app.core.config import Settings
from app.files.incoming import IncomingFile
from app.files.library import AssetLibrary
from app.files.policy import ATTACHMENT_EXTENSIONS
from app.files.project_snapshots import _validate_member
from app.files.storage import AssetStorage
from app.models.files import VisualAsset
from app.models.thought_workshop import ThoughtFolder, ThoughtKnowledgeBase, ThoughtNote
from app.schemas.thought_document import file_ids
from app.schemas.thought_knowledge import ThoughtFolderOut
from app.schemas.thought_workshop import ThoughtImportOut, ThoughtNoteIn
from app.thought_workshop.archive_structure import validate_structure
from app.thought_workshop.knowledge import KnowledgeBases
from app.thought_workshop.legacy_import import convert_legacy_backup
from app.thought_workshop.notes import Notes, ThoughtError, note_out

FORMAT = "thought-workshop-backup"


def archive_times(record: dict) -> None:
    for key in ("created_at", "updated_at", "deleted_at"):
        value = record.get(key)
        if value is None:
            continue
        if not isinstance(value, str) or len(value) > 64:
            raise ThoughtError("备份时间格式无效")
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is not None:
            parsed = parsed.astimezone(UTC).replace(tzinfo=None)
        record[key] = parsed


def remap_images(node: dict, mapping: dict[str, str]) -> None:
    if node.get("type") in {"image", "attachment"}:
        node["attrs"]["assetId"] = mapping[node["attrs"]["assetId"]]
    for child in node.get("content", []):
        remap_images(child, mapping)


async def export_backup(
    notes: Notes, settings: Settings, knowledge_base_id: str | None = None
) -> Path:
    knowledge = KnowledgeBases(notes.session, notes.workspace_id)
    projects = (
        [await knowledge.output(await knowledge.get(knowledge_base_id, include_deleted=True))]
        if knowledge_base_id
        else [*await knowledge.list(), *await knowledge.list(trash=True)]
    )
    project_ids = [p.id for p in projects]
    folders = (
        await notes.session.scalars(
            select(ThoughtFolder).where(ThoughtFolder.knowledge_base_id.in_(project_ids))
        )
    ).all()
    rows = (
        await notes.session.scalars(
            select(ThoughtNote)
            .where(
                ThoughtNote.workspace_id == notes.workspace_id,
                ThoughtNote.knowledge_base_id.in_(project_ids),
            )
            .order_by(ThoughtNote.id)
        )
    ).all()
    documents = [note_out(row).model_dump(mode="json") for row in rows]
    ids = {asset_id for doc in documents for asset_id in file_ids(doc["document"])}
    ids.update(p.cover_asset_id for p in projects if p.cover_asset_id)
    assets = (
        (
            await notes.session.scalars(
                select(VisualAsset).where(
                    VisualAsset.id.in_(ids),
                    VisualAsset.workspace_id == notes.workspace_id,
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
    payload = {
        "format": FORMAT,
        "version": 3,
        "knowledge_bases": [r.model_dump(mode="json") for r in projects],
        "folders": [ThoughtFolderOut.model_validate(r).model_dump(mode="json") for r in folders],
        "notes": documents,
        "assets": [
            {"id": rid, "path": f"assets/{rid}", "filename": name, "content_type": mime}
            for rid, _, name, mime in sources
        ],
    }
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


def validate_archive(
    path: Path, root: Path, settings: Settings
) -> tuple[dict, list[ThoughtNoteIn]]:
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        if len(entries) > settings.fpl_project_snapshot_max_files:
            raise ThoughtError("导入文件数量超过限制", 413)
        if sum(item.file_size for item in entries) > settings.fpl_project_snapshot_max_bytes:
            raise ThoughtError("解压大小超过限制", 413)
        names = set()
        for item in entries:
            _validate_member(item)
            if item.filename in names:
                raise ThoughtError("归档包含重复路径")
            names.add(item.filename)
        manifest = archive.getinfo("manifest.json")
        if manifest.file_size > 32 * 1024 * 1024:
            raise ThoughtError("备份清单过大", 413)
        payload = json.loads(archive.read(manifest))
        if (
            not isinstance(payload, dict)
            or payload.get("format") != FORMAT
            or payload.get("version") not in {1, 2, 3}
        ):
            raise ThoughtError("不支持的备份格式或版本")
        payload = convert_legacy_backup(payload)
        parsed = validate_structure(payload)
        for group in ("knowledge_bases", "folders", "notes"):
            for record in payload.get(group, []):
                archive_times(record)
        assets = payload.get("assets", [])
        for i, asset in enumerate(assets):
            if asset["path"] not in names:
                raise ThoughtError("备份缺少附件文件")
            info = archive.getinfo(asset["path"])
            if info.file_size > settings.fpl_visual_asset_max_bytes:
                raise ThoughtError("文件超过大小限制", 413)
            dest = root / f"image-{i}"
            with archive.open(info) as source, dest.open("wb") as target:
                shutil.copyfileobj(source, target)
            asset["staged_path"] = str(dest)
    return payload, parsed


async def import_backup(
    notes: Notes,
    settings: Settings,
    upload: IncomingFile,
    knowledge_base_id: str | None = None,
    expected_revision: int | None = None,
) -> ThoughtImportOut:
    root = Path(tempfile.mkdtemp(prefix="thought-import-"))
    files: list[Path] = []
    try:
        path = root / "upload.zip"
        size = 0
        with path.open("wb") as target:
            while chunk := await upload.read(1024 * 1024):
                size += len(chunk)
                if size > settings.fpl_project_snapshot_max_bytes:
                    raise ThoughtError("备份超过大小限制", 413)
                await asyncio.to_thread(target.write, chunk)
        payload, parsed = await asyncio.to_thread(validate_archive, path, root, settings)
        await notes.session.rollback()
        mapping: dict[str, str] = {}
        library = AssetLibrary(notes.session, settings)
        # Deferred staging validates and copies all files before any database write.
        staged_rows = []
        with notes.session.no_autoflush:
            for asset in payload["assets"]:
                row, final_path = await library.stage_local_copy(
                    Path(asset["staged_path"]),
                    workspace_id=notes.workspace_id,
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
        notes.session.add_all(staged_rows)
        knowledge = KnowledgeBases(notes.session, notes.workspace_id)
        project_mapping, folder_mapping = (
            {},
            {f["id"]: str(uuid4()) for f in payload.get("folders", [])},
        )
        project_rows = {}
        if knowledge_base_id:
            if expected_revision is None:
                raise ThoughtError("导入当前知识库需要修订号")
            await knowledge.reserve(knowledge_base_id, expected_revision)
        for project in payload["knowledge_bases"]:
            if knowledge_base_id:
                project_mapping[project["id"]] = knowledge_base_id
                continue
            row = ThoughtKnowledgeBase(
                id=str(uuid4()),
                workspace_id=notes.workspace_id,
                title=project["title"],
                description=project.get("description", ""),
                cover_asset_id=mapping.get(project.get("cover_asset_id")),
                **{
                    k: project[k]
                    for k in ("created_at", "updated_at", "deleted_at")
                    if project.get(k)
                },
            )
            notes.session.add(row)
            project_mapping[project["id"]], project_rows[project["id"]] = row.id, row
        await notes.session.flush()
        # Parent-first insertion works with immediate SQLite foreign keys.
        pending = list(payload.get("folders", []))
        inserted = set()
        while pending:
            for folder in list(pending):
                if folder.get("parent_id") and folder["parent_id"] not in inserted:
                    continue
                notes.session.add(
                    ThoughtFolder(
                        id=folder_mapping[folder["id"]],
                        knowledge_base_id=project_mapping[folder["knowledge_base_id"]],
                        title=folder["title"],
                        parent_id=folder_mapping.get(folder.get("parent_id")),
                        position=folder.get("position", 0),
                        **{k: folder[k] for k in ("created_at", "updated_at") if folder.get(k)},
                    )
                )
                await notes.session.flush()
                inserted.add(folder["id"])
                pending.remove(folder)
        result = []
        for source, body in zip(payload["notes"], parsed, strict=True):
            if knowledge_base_id and source.get("is_home"):
                continue
            document = copy.deepcopy(body.document)
            remap_images(document, mapping)
            body = body.model_copy(
                update={
                    "document": document,
                    "knowledge_base_id": project_mapping[body.knowledge_base_id],
                    "folder_id": folder_mapping.get(body.folder_id),
                }
            )
            # Restoring a trashed project is staged as active until all notes are validated.
            row = await notes.create(body, commit=False, importing=True)
            row.is_home, row.position = bool(source.get("is_home")), source.get("position", 0)
            for key in ("created_at", "updated_at", "deleted_at"):
                if source.get(key):
                    setattr(row, key, source[key])
            if row.is_home:
                project_rows[source["knowledge_base_id"]].home_note_id = row.id
            if not row.is_home:
                result.append(row.id)
        for row in project_rows.values():
            await knowledge.cover(row.cover_asset_id)
        await notes.session.commit()
        files.clear()
        return ThoughtImportOut(
            note_ids=result, knowledge_base_ids=list(dict.fromkeys(project_mapping.values()))
        )
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
