from __future__ import annotations

import base64
import json

from fastapi import HTTPException
from sqlalchemy import and_, delete, func, or_, select, text, update

from .models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchEntry,
    WorkbenchSession,
    WorkbenchSource,
)
from .schemas import WorkbenchEntryOut, WorkbenchHistory, WorkbenchSessionOut, WorkbenchSessionPage


async def get_conversation(session, owner, session_id):
    row = await session.scalar(
        select(WorkbenchSession).where(
            WorkbenchSession.id == session_id, WorkbenchSession.owner_user_id == owner
        )
    )
    if row is None:
        raise HTTPException(404, "会话不存在")
    return row


async def change_cursor(session, owner):
    return (
        await session.scalar(
            select(func.max(WorkbenchChange.id)).where(WorkbenchChange.owner_user_id == owner)
        )
        or 0
    )


async def session_out(session, row):
    result = WorkbenchSessionOut.model_validate(row)
    result.source_ids = list(
        (
            await session.scalars(
                select(WorkbenchCheckpoint.source_id)
                .join(WorkbenchSource, WorkbenchCheckpoint.source_id == WorkbenchSource.id)
                .where(
                    WorkbenchCheckpoint.session_id == row.id,
                    WorkbenchSource.owner_user_id == row.owner_user_id,
                    WorkbenchSource.status != "unbound",
                )
                .distinct()
            )
        ).all()
    )
    result.source_errors = list(
        (
            await session.scalars(
                select(WorkbenchCheckpoint.error)
                .where(WorkbenchCheckpoint.session_id == row.id, WorkbenchCheckpoint.error != "")
                .distinct()
            )
        ).all()
    )
    return result


async def list_conversations(
    session,
    owner,
    *,
    q="",
    agent_id=None,
    origin=None,
    project=None,
    archived=None,
    favorite=False,
    cursor=None,
    limit=50,
):
    if "\x00" in q:
        raise HTTPException(422, "搜索内容包含无效字符")
    query = select(WorkbenchSession).where(WorkbenchSession.owner_user_id == owner)
    if agent_id:
        query = query.where(WorkbenchSession.agent_id == agent_id)
    if origin:
        query = query.where(
            WorkbenchSession.origins.contains(origin)
            if origin != "unknown"
            else WorkbenchSession.origins == []
        )
    if project:
        query = query.where(WorkbenchSession.cwd == project)
    if archived is not None:
        query = query.where(WorkbenchSession.archived == archived)
    if favorite:
        query = query.where(WorkbenchSession.favorite.is_(True))
    if q.strip():
        # Quoted FTS phrases cannot inject operators or expose other owners' matches.
        matches = await session.execute(
            text(
                "SELECT DISTINCT session_id FROM agent_workbench_search "
                "WHERE owner_user_id=:owner AND agent_workbench_search MATCH :query LIMIT 20000"
            ),
            {"owner": owner, "query": '"' + q.strip().replace('"', '""') + '"'},
        )
        ids = [row[0] for row in matches]
        query = query.where(
            or_(
                WorkbenchSession.title.icontains(q, autoescape=True),
                WorkbenchSession.alias.icontains(q, autoescape=True),
                WorkbenchSession.cwd.icontains(q, autoescape=True),
                WorkbenchSession.id.in_(ids),
            )
        )
    if cursor:
        try:
            updated, key = json.loads(base64.urlsafe_b64decode(cursor))
            if not isinstance(updated, str) or not isinstance(key, str):
                raise ValueError
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "分页游标无效") from exc
        query = query.where(
            or_(
                WorkbenchSession.updated_at < updated,
                and_(WorkbenchSession.updated_at == updated, WorkbenchSession.id < key),
            )
        )
    rows = list(
        (
            await session.scalars(
                query.order_by(
                    WorkbenchSession.updated_at.desc(), WorkbenchSession.id.desc()
                ).limit(limit + 1)
            )
        ).all()
    )
    next_cursor = None
    if len(rows) > limit:
        rows = rows[:limit]
        next_cursor = base64.urlsafe_b64encode(
            json.dumps([rows[-1].updated_at, rows[-1].id]).encode()
        ).decode()
    # Resolve links in one query; avoid one query per list item.
    links = (
        await session.execute(
            select(
                WorkbenchCheckpoint.session_id,
                WorkbenchCheckpoint.source_id,
                WorkbenchCheckpoint.error,
            )
            .join(WorkbenchSource, WorkbenchSource.id == WorkbenchCheckpoint.source_id)
            .where(
                WorkbenchCheckpoint.session_id.in_([r.id for r in rows]),
                WorkbenchSource.owner_user_id == owner,
                WorkbenchSource.status != "unbound",
            )
            .distinct()
        )
    ).all()
    items = []
    for row in rows:
        item = WorkbenchSessionOut.model_validate(row)
        item.source_ids = [source for key, source, _ in links if key == row.id]
        item.source_errors = list(
            dict.fromkeys(error for key, _, error in links if key == row.id and error)
        )
        items.append(item)
    return WorkbenchSessionPage(
        items=items, next_cursor=next_cursor, change_cursor=await change_cursor(session, owner)
    )


async def history(
    session, owner, session_id, *, before=None, limit=50, branch=None, before_native_id=None
):
    conversation = await get_conversation(session, owner, session_id)
    query = select(WorkbenchEntry).where(WorkbenchEntry.session_id == session_id)
    branches = []
    if conversation.agent_id == "pi":
        edges = (
            await session.execute(
                select(WorkbenchEntry.native_id, WorkbenchEntry.parent_id)
                .where(WorkbenchEntry.session_id == session_id)
                .order_by(WorkbenchEntry.ordinal)
            )
        ).all()
        parents = dict(edges)
        nonleaves = {parent for _, parent in edges if parent}
        branches = [key for key, _ in edges if key not in nonleaves]
        branch = branch or (edges[-1][0] if edges else None)
        if branch and branch not in parents:
            raise HTTPException(422, "分支不存在")
        chain = set()
        current = branch
        while current and current not in chain:
            chain.add(current)
            current = parents.get(current)
        query = query.where(WorkbenchEntry.native_id.in_(chain))
    query = query.where(WorkbenchEntry.kind != "branch_metadata")
    if before_native_id is not None:
        if before is None:
            raise HTTPException(422, "分页游标缺少序号")
        query = query.where(
            or_(
                WorkbenchEntry.ordinal < before,
                and_(WorkbenchEntry.ordinal == before, WorkbenchEntry.native_id < before_native_id),
            )
        )
    elif before is not None:
        query = query.where(WorkbenchEntry.ordinal < before)
    rows = list(
        (
            await session.scalars(
                query.order_by(
                    WorkbenchEntry.ordinal.desc(), WorkbenchEntry.native_id.desc()
                ).limit(limit + 1)
            )
        ).all()
    )
    more = len(rows) > limit
    rows = rows[:limit]
    items = [WorkbenchEntryOut.model_validate(row) for row in reversed(rows)]
    for item in items:
        item.attachments = [{"id": a["id"], "name": a["name"]} for a in item.attachments]
    return WorkbenchHistory(
        items=items,
        next_cursor=rows[-1].ordinal if more else None,
        next_cursor_native_id=rows[-1].native_id if more else None,
        change_cursor=await change_cursor(session, owner),
        branches=branches,
        selected_branch=branch,
    )


async def preferences(session, owner, session_id, body):
    row = await get_conversation(session, owner, session_id)
    values = body.model_dump(exclude_none=True, exclude={"expected_revision"})
    values["revision"] = body.expected_revision + 1
    result = await session.execute(
        update(WorkbenchSession)
        .where(
            WorkbenchSession.id == session_id,
            WorkbenchSession.owner_user_id == owner,
            WorkbenchSession.revision == body.expected_revision,
        )
        .values(**values)
    )
    if not result.rowcount:
        await session.rollback()
        await session.refresh(row)
        raise HTTPException(
            409,
            {
                "code": "revision_conflict",
                "current": WorkbenchSessionOut.model_validate(row).model_dump(mode="json"),
            },
        )
    session.add(WorkbenchChange(owner_user_id=owner, session_id=session_id, kind="session"))
    await session.commit()
    await session.refresh(row)
    return await session_out(session, row)


async def clear_copy(session, owner, session_id, revision):
    row = await get_conversation(session, owner, session_id)
    active = await session.scalar(
        select(WorkbenchSource.id)
        .join(WorkbenchCheckpoint, WorkbenchCheckpoint.source_id == WorkbenchSource.id)
        .where(
            WorkbenchCheckpoint.session_id == session_id,
            WorkbenchSource.enabled.is_(True),
            WorkbenchSource.owner_user_id == owner,
        )
    )
    if active:
        raise HTTPException(409, "请先停用对应来源同步，再清除阅读副本")
    result = await session.execute(
        delete(WorkbenchSession).where(
            WorkbenchSession.id == row.id,
            WorkbenchSession.revision == revision,
            WorkbenchSession.owner_user_id == owner,
        )
    )
    if not result.rowcount:
        raise HTTPException(409, "会话已改变，请刷新后重试")
    await session.execute(
        text("DELETE FROM agent_workbench_search WHERE owner_user_id=:owner AND session_id=:id"),
        {"owner": owner, "id": session_id},
    )
    session.add(WorkbenchChange(owner_user_id=owner, session_id=session_id, kind="session"))
    await session.commit()
