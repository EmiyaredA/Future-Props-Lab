"""Thought-owned validation, ID allocation and archive persistence."""

import copy
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import UUID, uuid4, uuid5

from studio.apps.thought_workshop.archive_structure import (
    convert_v3_folders_to_notes,
    validate_structure,
)
from studio.apps.thought_workshop.backup_manifest import FORMAT
from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.history_archive import import_history, validate_history
from studio.apps.thought_workshop.knowledge import KnowledgeBases
from studio.apps.thought_workshop.knowledge_tools.archive import import_tools, validate_tools
from studio.apps.thought_workshop.knowledge_tools.references import remap_references
from studio.apps.thought_workshop.knowledge_tools.schemas import TemplateOut
from studio.apps.thought_workshop.legacy_import import convert_legacy_backup
from studio.apps.thought_workshop.multitable.archive import (
    archive_assets,
    entity_mapping,
    import_tables,
    remap_embeds,
)
from studio.apps.thought_workshop.multitable.archive import validate_archive as validate_tables
from studio.apps.thought_workshop.multitable.storage import asset_ids
from studio.apps.thought_workshop.schemas.canvas import remap_canvas
from studio.apps.thought_workshop.schemas.document import file_ids
from studio.apps.thought_workshop.schemas.history import ThoughtHistorySnapshot
from studio.apps.thought_workshop.schemas.workshop import ThoughtImportOut
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase


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
    if node.get("type") == "canvas":
        node["attrs"]["scene"] = remap_canvas(node["attrs"]["scene"], mapping)
    if node.get("type") in {"image", "attachment"}:
        node["attrs"]["assetId"] = mapping[node["attrs"]["assetId"]]
    for child in node.get("content", []):
        remap_images(child, mapping)


def validate_payload(payload):
    if (
        not isinstance(payload, dict)
        or payload.get("format") != FORMAT
        or payload.get("version") not in {1, 2, 3, 4, 5, 6, 7, 8, 9}
    ):
        raise ThoughtError("不支持的备份格式或版本")
    payload = convert_legacy_backup(payload)
    payload = convert_v3_folders_to_notes(payload)
    parsed = validate_structure(payload)
    validate_history(payload)
    validate_tools(payload)
    validate_tables(payload)
    for group in ("knowledge_bases", "notes"):
        for record in payload.get(group, []):
            archive_times(record)
    return payload, parsed


@dataclass(frozen=True)
class ArchiveIds:
    projects: dict[str, str]
    notes: dict[str, str]
    templates: dict[str, str]


def allocate_ids(payload, *, namespace: UUID | None = None):
    def allocate(group):
        return {
            row["id"]: str(uuid5(namespace, f"{group}:{row['id']}") if namespace else uuid4())
            for row in payload.get(group, [])
        }

    return ArchiveIds(
        projects=allocate("knowledge_bases"),
        notes=allocate("notes"),
        templates=allocate("templates"),
    )


def archive_references(payload, parsed, ids: ArchiveIds, assets, *, into_existing=False):
    """Return complete initial pins, including files used only in history."""
    references = {}
    if not into_existing:
        for project in payload["knowledge_bases"]:
            cover = project.get("cover_asset_id")
            references["knowledge-base", ids.projects[project["id"]]] = (
                {assets[cover]} if cover else set()
            )
    imported_notes = {
        source["id"]: file_ids(body.document)
        for source, body in zip(payload["notes"], parsed, strict=True)
        if not (into_existing and source.get("is_home"))
    }
    for entry in payload.get("history", []):
        if entry["note_id"] in imported_notes:
            snapshot = ThoughtHistorySnapshot.model_validate(entry)
            imported_notes[snapshot.note_id].update(file_ids(snapshot.document))
    for note_id, table in payload.get("multitables", {}).items():
        if note_id in imported_notes:
            imported_notes[note_id].update(archive_assets({note_id: table}))
    for note_id, pins in imported_notes.items():
        references["note", ids.notes[note_id]] = {assets[pin] for pin in pins}
    for entry in payload.get("templates", []):
        template = TemplateOut.model_validate(entry)
        pins = file_ids(template.document)
        if template.multitable:
            pins.update(asset_ids(template.multitable))
        references["template", ids.templates[template.id]] = {assets[pin] for pin in pins}
    return references


async def persist_archive(
    notes,
    payload,
    parsed,
    mapping,
    ids: ArchiveIds,
    knowledge_base_id=None,
    expected_revision=None,
):
    knowledge = KnowledgeBases(notes.session, notes.owner_user_id)
    project_mapping = {}
    note_mapping = dict(ids.notes)
    project_rows = {}
    warnings = set()
    table_mapping = entity_mapping(payload.get("multitables", {}))
    if knowledge_base_id:
        if expected_revision is None:
            raise ThoughtError("导入当前知识库需要修订号")
        await knowledge.reserve(knowledge_base_id, expected_revision)
        target_project = await knowledge.get(knowledge_base_id)
        for note in payload["notes"]:
            if note.get("is_home"):
                note_mapping[note["id"]] = target_project.home_note_id
    for project in payload["knowledge_bases"]:
        if knowledge_base_id:
            project_mapping[project["id"]] = knowledge_base_id
            continue
        row = ThoughtKnowledgeBase(
            id=ids.projects[project["id"]],
            owner_user_id=notes.owner_user_id,
            title=project["title"],
            description=project.get("description", ""),
            cover_asset_id=mapping.get(project.get("cover_asset_id")),
            **{k: project[k] for k in ("created_at", "updated_at", "deleted_at") if project.get(k)},
        )
        notes.session.add(row)
        project_mapping[project["id"]], project_rows[project["id"]] = row.id, row
    await notes.session.flush()
    # Parent-first insertion works with immediate SQLite foreign keys.
    pending = list(zip(payload["notes"], parsed, strict=True))
    inserted: set[str] = set()
    result = []
    while pending:
        progressed = False
        for index, (source, body) in enumerate(list(pending)):
            if source.get("parent_id") and source["parent_id"] not in inserted:
                continue
            if knowledge_base_id and source.get("is_home"):
                pending.pop(index)
                progressed = True
                break
            document = remap_references(
                copy.deepcopy(body.document), note_mapping, portable=True, warnings=warnings
            )
            remap_images(document, mapping)
            remap_embeds(document, table_mapping)
            created = body.model_copy(
                update={
                    "document": document,
                    "knowledge_base_id": project_mapping[body.knowledge_base_id],
                    "parent_id": note_mapping.get(body.parent_id) if body.parent_id else None,
                }
            )
            row = await notes.create(
                created,
                commit=False,
                importing=True,
                note_id=note_mapping[source["id"]],
            )
            row.is_home, row.position = bool(source.get("is_home")), source.get("position", 0)
            for key in ("created_at", "updated_at", "deleted_at"):
                if source.get(key):
                    setattr(row, key, source[key])
            if row.is_home:
                project_rows[source["knowledge_base_id"]].home_note_id = row.id
            if not row.is_home:
                result.append(row.id)
            inserted.add(source["id"])
            pending.pop(index)
            progressed = True
            break
        if not progressed:
            raise ThoughtError("备份目录循环或归属错误")
    for row in project_rows.values():
        await knowledge.cover(row.cover_asset_id)

    def remap_all(document, assets):
        remap_images(document, assets)
        rewritten = remap_references(document, note_mapping, portable=True, warnings=warnings)
        remap_embeds(rewritten, table_mapping)
        document.clear()
        document.update(rewritten)

    history_mapping = await import_history(
        notes, payload, inserted, note_mapping, mapping, remap_all
    )
    await import_tools(
        notes.session,
        notes.owner_user_id,
        payload,
        note_mapping,
        history_mapping,
        mapping,
        remap_images,
        warnings,
        template_ids=ids.templates,
    )
    await import_tables(
        notes.session, payload.get("multitables", {}), note_mapping, mapping, table_mapping
    )
    output = ThoughtImportOut(
        warnings=sorted(warnings),
        note_ids=result,
        knowledge_base_ids=list(dict.fromkeys(project_mapping.values())),
    )
    return output, note_mapping, project_mapping
