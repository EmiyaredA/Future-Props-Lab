"""account-wide Chinese-friendly substring search without another service."""

from sqlalchemy import case, func, or_, select

from studio.apps.thought_workshop.knowledge_tools.schemas import SearchHit, SearchResult
from studio.apps.thought_workshop.notes import note_out
from studio.apps.thought_workshop.storage.models import ThoughtKnowledgeBase, ThoughtNote


async def search(session, owner_user_id, criteria, offset, limit):
    filters = [
        ThoughtNote.owner_user_id == owner_user_id,
        ThoughtNote.deleted_at.is_(None),
        ThoughtKnowledgeBase.deleted_at.is_(None),
    ]
    q = criteria.query.strip()
    title_match = func.lower(ThoughtNote.title).contains(q.lower(), autoescape=True)
    tag_values = func.json_each(ThoughtNote.tags).table_valued("value")
    tag_match = (
        select(1)
        .select_from(tag_values)
        .where(func.lower(tag_values.c.value).contains(q.lower(), autoescape=True))
        .exists()
    )
    body_match = func.lower(ThoughtNote.search_text).contains(q.lower(), autoescape=True)
    if q:
        filters.append(
            title_match if criteria.title_only else or_(title_match, tag_match, body_match)
        )
    if criteria.knowledge_base_id:
        filters.append(ThoughtNote.knowledge_base_id == criteria.knowledge_base_id)
    if criteria.favorite:
        filters.append(ThoughtNote.favorite.is_(True))
    if criteria.tag:
        tags = func.json_each(ThoughtNote.tags).table_valued("value")
        filters.append(select(1).select_from(tags).where(tags.c.value == criteria.tag).exists())
    join = ThoughtKnowledgeBase.id == ThoughtNote.knowledge_base_id
    total = await session.scalar(
        select(func.count())
        .select_from(ThoughtNote)
        .join(ThoughtKnowledgeBase, join)
        .where(*filters)
    )
    rows = list(
        (
            await session.execute(
                select(ThoughtNote, ThoughtKnowledgeBase.title)
                .join(ThoughtKnowledgeBase, join)
                .where(*filters)
                .order_by(
                    case((title_match, 0), (tag_match, 1), else_=2),
                    ThoughtNote.updated_at.desc(),
                    ThoughtNote.id,
                )
                .offset(offset)
                .limit(limit)
            )
        ).all()
    )
    # Fetch ancestor summaries once; never pull unrelated document JSON into search results.
    project_ids = {row.knowledge_base_id for row, _ in rows}
    ancestors = (
        await session.execute(
            select(ThoughtNote.id, ThoughtNote.parent_id, ThoughtNote.title).where(
                ThoughtNote.owner_user_id == owner_user_id,
                ThoughtNote.knowledge_base_id.in_(project_ids),
                ThoughtNote.deleted_at.is_(None),
            )
        )
    ).all()
    by_id = {id: (parent, title) for id, parent, title in ancestors}
    items = []
    for row, project_title in rows:
        path, parent, seen = [], row.parent_id, set()
        while parent in by_id and parent not in seen:
            seen.add(parent)
            parent, title = by_id[parent]
            path.insert(0, title)
        text = row.search_text
        index = text.lower().find(q.lower()) if q else 0
        start = max(0, index - 60)
        snippet = (
            ("…" if start else "")
            + text[start : start + 240]
            + ("…" if len(text) > start + 240 else "")
        )
        items.append(
            SearchHit(
                **note_out(row).model_dump(exclude={"document", "schema_version"}),
                knowledge_base_title=project_title,
                path=path,
                snippet=snippet,
            )
        )
    return SearchResult(items=items, total=total or 0)
