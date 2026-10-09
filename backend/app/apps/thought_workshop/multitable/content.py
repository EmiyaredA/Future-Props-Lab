"""Static content projections: exports contain visible current values, never history."""

from copy import deepcopy

from sqlalchemy import select

from app.apps.thought_workshop.models import ThoughtKnowledgeBase, ThoughtNote

from .formatting import format_value
from .query import records
from .schemas import QueryIn
from .storage import snapshot


def paragraph(text):
    return {"type": "paragraph", "content": [{"type": "text", "text": text}] if text else []}


async def table_nodes(session, workspace_id, table, rows, *, view=None, readable=None):
    hidden = set(view.config.hidden_fields) if view else set()
    order = view.config.column_order if view else []
    fields = sorted(
        [f for f in table.fields if f.id not in hidden],
        key=lambda f: order.index(f.id) if f.id in order else len(order) + f.position,
    )
    targets = {
        id for f in fields if f.type == "note" for r in rows for id in r.values.get(f.id, []) or []
    }
    titles = dict(
        (
            await session.execute(
                select(ThoughtNote.id, ThoughtNote.title)
                .join(
                    ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id
                )
                .where(
                    ThoughtNote.workspace_id == workspace_id,
                    ThoughtNote.id.in_(targets),
                    ThoughtNote.deleted_at.is_(None),
                    ThoughtKnowledgeBase.deleted_at.is_(None),
                )
            )
        ).all()
    )
    if readable is not None:
        titles = {id: title for id, title in titles.items() if id in readable}

    def label(f, value):
        if value is None:
            return ""
        if f.type in {"single", "multi"}:
            options = {o.id: o.label for o in f.options}
            return (
                "; ".join(options.get(id, id) for id in value)
                if isinstance(value, list)
                else options.get(value, value)
            )
        if f.type == "note":
            return "; ".join(titles.get(id, "文档不可访问") for id in value)
        if f.type == "attachment":
            return f"{len(value)} 个附件（请从原表下载）"
        if f.type == "person":
            ids = value if isinstance(value, list) else [value]
            return "; ".join(str(item) for item in ids)
        if f.type == "checkbox":
            return "是" if value else "否"
        return format_value(f, value)

    return [
        {
            "type": "heading",
            "attrs": {"level": 2},
            "content": [{"type": "text", "text": table.name}],
        },
        {
            "type": "table",
            "content": [
                {
                    "type": "tableRow",
                    "content": [
                        {"type": "tableHeader", "content": [paragraph(f.name)]} for f in fields
                    ],
                },
                *[
                    {
                        "type": "tableRow",
                        "content": [
                            {
                                "type": "tableCell",
                                "content": [paragraph(label(f, r.values.get(f.id)))],
                            }
                            for f in fields
                        ],
                    }
                    for r in rows
                ],
            ],
        },
    ]


async def project(session, workspace_id, note, *, readable=None):
    if note.kind == "multitable":
        state = await snapshot(session, note.id)
        nodes = []
        for t in state.tables:
            nodes.extend(
                await table_nodes(session, workspace_id, t, state.records[t.id], readable=readable)
            )
        return {"type": "doc", "content": nodes}
    document = deepcopy(note.document)

    async def walk(node):
        children = []
        for child in node.get("content", []):
            if child.get("type") != "multitableView":
                await walk(child)
                children.append(child)
                continue
            attrs = child["attrs"]
            target = await session.scalar(
                select(ThoughtNote)
                .join(
                    ThoughtKnowledgeBase, ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id
                )
                .where(
                    ThoughtNote.id == attrs.get("noteId"),
                    ThoughtNote.workspace_id == workspace_id,
                    ThoughtNote.deleted_at.is_(None),
                    ThoughtKnowledgeBase.deleted_at.is_(None),
                    ThoughtNote.kind == "multitable",
                )
            )
            if target is None or (readable is not None and target.id not in readable):
                children.append(paragraph("多维表格不可访问"))
                continue
            state = await snapshot(session, target.id, include_records=False)
            t = next((t for t in state.tables if t.id == attrs.get("tableId")), None)
            v = next((v for v in t.views if v.id == attrs.get("viewId")), None) if t else None
            if v is None:
                children.append(paragraph("多维表格视图已删除"))
                continue
            rows = []
            for offset in range(0, 5000, 200):
                page = await records(
                    session, t, QueryIn(view_id=v.id, offset=offset, limit=200), target.revision
                )
                rows.extend(page.items)
                if len(rows) >= page.total:
                    break
            children.extend(
                await table_nodes(session, workspace_id, t, rows, view=v, readable=readable)
            )
        if "content" in node:
            node["content"] = children

    await walk(document)
    return document
