"""Stable document references; missing targets never prevent retaining an old link."""

from copy import deepcopy

from sqlalchemy import delete, select

from studio.apps.thought_workshop.errors import ThoughtError
from studio.apps.thought_workshop.knowledge_tools.models import ThoughtDocumentReference
from studio.apps.thought_workshop.knowledge_tools.schemas import ReferenceTarget
from studio.apps.thought_workshop.multitable.models import DataTable, DataView
from studio.apps.thought_workshop.schemas.workshop import ThoughtNoteSummary
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote


def reference_nodes(node):
    if node.get("type") in {
        "documentReference",
        "documentCard",
        "documentDirectory",
        "multitableView",
    }:
        yield node
    for child in node.get("content", []):
        yield from reference_nodes(child)


def reference_ids(document):
    return {
        value
        for node in reference_nodes(document)
        if node["attrs"].get("kind", "note") == "note"
        if (
            value := node["attrs"].get(
                "parentId" if node["type"] == "documentDirectory" else "noteId"
            )
        )
    }


async def validate_targets(session, owner_user_id, document, existing=None):
    prior = {
        (n["attrs"].get("noteId"), n["attrs"].get("tableId"), n["attrs"].get("viewId"))
        for n in reference_nodes(existing or {})
        if n["type"] == "multitableView"
    }
    for node in reference_nodes(document):
        if node["type"] != "multitableView" or not node["attrs"].get("noteId"):
            continue
        a = node["attrs"]
        if (a["noteId"], a["tableId"], a["viewId"]) in prior:
            continue
        if not await session.scalar(
            select(DataView.id)
            .join(DataTable, DataTable.id == DataView.table_id)
            .join(ThoughtNote, ThoughtNote.id == DataTable.note_id)
            .where(
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.id == a["noteId"],
                ThoughtNote.kind == "multitable",
                ThoughtNote.deleted_at.is_(None),
                DataTable.id == a["tableId"],
                DataView.id == a["viewId"],
            )
        ):
            raise ThoughtError("多维表格视图不存在或不可访问", 404, "not_found")
    ids = reference_ids(document) - reference_ids(existing or {})
    if not ids:
        return
    found = set(
        await session.scalars(
            select(ThoughtNote.id)
            .join(ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id)
            .where(
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.id.in_(ids),
                ThoughtNote.deleted_at.is_(None),
                ThoughtKnowledgeBase.deleted_at.is_(None),
            )
        )
    )
    if ids != found:
        raise ThoughtError("引用文档不存在或不可访问", 404, "not_found")


async def index_references(session, note_id, document):
    await session.execute(
        delete(ThoughtDocumentReference).where(ThoughtDocumentReference.note_id == note_id)
    )
    session.add_all(
        ThoughtDocumentReference(note_id=note_id, target_id=target)
        for target in reference_ids(document)
    )


async def index_table_references(session, note_id, state):
    targets = {
        target
        for table in state.tables
        for field in table.fields
        if field.type == "note"
        for record in state.records.get(table.id, [])
        for target in record.values.get(field.id, []) or []
    }
    await index_references(
        session,
        note_id,
        {"content": [{"type": "documentCard", "attrs": {"noteId": id}} for id in targets]},
    )


async def resolve(session, owner_user_id, ids):
    rows = list(
        await session.scalars(
            select(ThoughtNote)
            .join(ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id)
            .where(
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.id.in_(ids),
                ThoughtNote.deleted_at.is_(None),
                ThoughtKnowledgeBase.deleted_at.is_(None),
            )
        )
    )
    by_id = {row.id: row for row in rows}
    return [
        ReferenceTarget(id=id, available=False)
        if id not in by_id
        else ReferenceTarget(
            id=id,
            available=True,
            title=by_id[id].title,
            knowledge_base_id=by_id[id].knowledge_base_id,
            excerpt=by_id[id].search_text[:240],
            revision=by_id[id].revision,
        )
        for id in dict.fromkeys(ids)
    ]


async def backlinks(session, owner_user_id, note_id, offset, limit):
    target = await resolve(session, owner_user_id, [note_id])
    if not target[0].available:
        raise ThoughtError("文档不存在", 404, "not_found")
    rows = list(
        await session.scalars(
            select(ThoughtNote)
            .join(ThoughtDocumentReference, ThoughtDocumentReference.note_id == ThoughtNote.id)
            .join(ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id)
            .where(
                ThoughtDocumentReference.target_id == note_id,
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.deleted_at.is_(None),
                ThoughtKnowledgeBase.deleted_at.is_(None),
            )
            .order_by(ThoughtNote.updated_at.desc(), ThoughtNote.id)
            .offset(offset)
            .limit(limit)
        )
    )
    return [
        ThoughtNoteSummary(
            **{
                key: getattr(row, key)
                for key in ThoughtNoteSummary.model_fields
                if key != "excerpt"
            },
            excerpt=row.search_text[:240],
        )
        for row in rows
    ]


def remap_references(document, mapping, *, portable=False, warnings=None):
    result = deepcopy(document)

    def walk(node):
        if node.get("type") == "multitableView":
            attrs = node["attrs"]
            if attrs["noteId"] in mapping:
                attrs["noteId"] = mapping[attrs["noteId"]]
            elif portable:
                node.clear()
                node.update(
                    type="paragraph",
                    content=[{"type": "text", "text": "多维表格引用不可用（源表不在备份内）"}],
                )
                if warnings is not None:
                    warnings.add("包外多维表格引用已保留为文字")
        if node.get("type") == "documentDirectory" and node.get("attrs", {}).get("parentId"):
            parent = node["attrs"]["parentId"]
            if parent in mapping or portable:
                node["attrs"]["parentId"] = mapping.get(parent)
        if (
            node.get("type") in {"documentReference", "documentCard"}
            and node["attrs"].get("kind", "note") == "note"
            and node["attrs"].get("noteId")
        ):
            attrs = node["attrs"]
            if attrs["noteId"] in mapping:
                attrs["noteId"] = mapping[attrs["noteId"]]
            elif portable:
                label = attrs.get("customLabel") or attrs.get("label") or "文档不可访问"
                if node["type"] == "documentCard":
                    attrs["noteId"] = None
                else:
                    node.clear()
                    node.update(type="text", text=label)
                if warnings is not None:
                    warnings.add("包外文档引用已保留为文字：" + label)
        for child in node.get("content", []):
            walk(child)

    walk(result)
    return result
