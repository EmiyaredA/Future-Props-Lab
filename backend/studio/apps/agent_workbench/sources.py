from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import or_, select, text, update
from sqlalchemy.exc import IntegrityError

from app.runtime.config import get_settings
from studio.apps.agent_workbench.schemas import WorkbenchSourceOut
from studio.apps.agent_workbench.storage.models import (
    WorkbenchChange,
    WorkbenchOperation,
    WorkbenchSource,
)


def source_out(row):
    result = WorkbenchSourceOut.model_validate(row)
    result.sync_mode = (
        ("native_events" if row.message.startswith("原生事件") else "api_poll")
        if row.endpoint
        else "log_follow"
    )
    return result


async def get_source(session, owner, source_id):
    row = await session.scalar(
        select(WorkbenchSource).where(
            WorkbenchSource.id == source_id, WorkbenchSource.owner_user_id == owner
        )
    )
    if row is None or row.status == "unbound":
        raise HTTPException(404, "来源不存在")
    return row


async def list_sources(session, owner):
    rows = (
        await session.scalars(
            select(WorkbenchSource)
            .where(WorkbenchSource.owner_user_id == owner, WorkbenchSource.status != "unbound")
            .order_by(WorkbenchSource.created_at)
        )
    ).all()
    return [source_out(row) for row in rows]


async def create_source(session, owner, body, *, location):
    if not get_settings().fpl_agent_workbench_enabled:
        raise HTTPException(403, "部署未启用 Agent 工作台")
    root, endpoint = location
    # Serialize overlapping allocations. The core-table query is an allocation
    # check only; no other account's metadata crosses the response boundary.
    await session.rollback()
    await session.execute(text("BEGIN IMMEDIATE"))
    rows = (
        (
            await session.execute(
                select(WorkbenchSource.__table__).where(
                    or_(
                        WorkbenchSource.__table__.c.agent_id == body.agent_id,
                        WorkbenchSource.__table__.c.owner_user_id != owner,
                    )
                )
            )
        )
        .mappings()
        .all()
    )
    for row in rows:
        row = SimpleNamespace(**row)
        overlap = (
            endpoint == row.endpoint
            if endpoint
            else (
                not row.endpoint
                and (Path(root).is_relative_to(row.root) or Path(row.root).is_relative_to(root))
            )
        )
        if overlap:
            if (
                row.owner_user_id == owner
                and row.status == "unbound"
                and row.root == root
                and row.endpoint == endpoint
            ):
                row = await session.get(WorkbenchSource, row.id)
                row.enabled = True
                row.status = "pending"
                row.label = body.label
                row.revision += 1
                await session.commit()
                return source_out(row)
            raise HTTPException(409, "此来源范围已有绑定，请使用已有来源或先处理其绑定")
    row = WorkbenchSource(
        owner_user_id=owner, agent_id=body.agent_id, label=body.label, root=root, endpoint=endpoint
    )
    session.add(row)
    session.add(WorkbenchChange(owner_user_id=owner, kind="source"))
    try:
        await session.commit()
    except IntegrityError as exc:
        await session.rollback()
        raise HTTPException(409, "来源已绑定") from exc
    return source_out(row)


async def patch_source(session, owner, source_id, body, *, unbind=False):
    row = await get_source(session, owner, source_id)
    values = {"revision": body.expected_revision + 1}
    if body.enabled is not None:
        values.update(
            enabled=body.enabled,
            status="pending" if body.enabled else "paused",
            message="等待同步" if body.enabled else "已停用来源同步",
        )
    if body.label is not None:
        values["label"] = body.label
    if unbind:
        values.update(enabled=False, status="unbound", message="来源已解除绑定；保留阅读副本")
    result = await session.execute(
        update(WorkbenchSource)
        .where(
            WorkbenchSource.id == row.id,
            WorkbenchSource.owner_user_id == owner,
            WorkbenchSource.revision == body.expected_revision,
        )
        .values(**values)
    )
    if not result.rowcount:
        await session.rollback()
        await session.refresh(row)
        raise HTTPException(
            409, {"code": "revision_conflict", "current": source_out(row).model_dump(mode="json")}
        )
    session.add(WorkbenchChange(owner_user_id=owner, kind="source"))
    if values.get("enabled") is False:
        await session.execute(
            update(WorkbenchOperation)
            .where(
                WorkbenchOperation.source_id == source_id,
                WorkbenchOperation.owner_user_id == owner,
                WorkbenchOperation.status == "queued",
            )
            .values(status="cancelled", message="来源同步已停用")
        )
    await session.commit()
    await session.refresh(row)
    return source_out(row)


async def scan_source(session, owner, source_id):
    row = await get_source(session, owner, source_id)
    if not row.enabled:
        raise HTTPException(409, "请先启用来源同步")
    pending = await session.scalar(
        select(WorkbenchOperation).where(
            WorkbenchOperation.owner_user_id == owner,
            WorkbenchOperation.source_id == source_id,
            WorkbenchOperation.status == "queued",
        )
    )
    if pending:
        return pending
    operation = WorkbenchOperation(owner_user_id=owner, source_id=source_id)
    session.add(operation)
    await session.commit()
    return operation


async def get_operation(session, owner, operation_id):
    row = await session.scalar(
        select(WorkbenchOperation).where(
            WorkbenchOperation.id == operation_id, WorkbenchOperation.owner_user_id == owner
        )
    )
    if row is None:
        raise HTTPException(404, "扫描任务不存在")
    return row
