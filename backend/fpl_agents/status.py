"""Native discovery health retains missing originals as readable FPL copies."""

from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import delete, func, select, text, update

from app.apps.agent_workbench.models import (
    WorkbenchChange,
    WorkbenchCheckpoint,
    WorkbenchOperation,
    WorkbenchSource,
)
from app.runtime.ownership import bind_owner
from app.runtime.time import utc_now

from .models import NativeSubscription


async def report_cycle(database, context, *, job_id, locators, errors, incomplete, native_events):
    present = set(locators)
    missing_message = "原生记录已消失，保留最后同步的阅读副本"
    async with database.sessions() as session:
        bind_owner(session, context["owner"])
        await session.execute(text("BEGIN IMMEDIATE"))
        subscription = await session.get(NativeSubscription, context["id"])
        if subscription is None or subscription.current_job_id != job_id:
            raise HTTPException(410, "native_subscription_changed")
        source = await session.get(WorkbenchSource, context["id"])
        if source is None or not source.enabled or source.revision != context["revision"]:
            raise HTTPException(410, "native_source_grant_changed")
        known = list(
            await session.execute(
                select(
                    WorkbenchCheckpoint.id,
                    WorkbenchCheckpoint.locator,
                    WorkbenchCheckpoint.error,
                    WorkbenchCheckpoint.session_id,
                ).where(WorkbenchCheckpoint.source_id == source.id)
            )
        )
        for values in known:
            row = SimpleNamespace(**values._mapping)
            if row.locator not in present and row.session_id is None:
                await session.execute(
                    delete(WorkbenchCheckpoint).where(WorkbenchCheckpoint.id == row.id)
                )
                continue
            error = (
                missing_message
                if row.locator not in present
                else ("" if row.error == missing_message else row.error)
            )
            if error != row.error:
                await session.execute(
                    update(WorkbenchCheckpoint)
                    .where(WorkbenchCheckpoint.id == row.id)
                    .values(error=error)
                )
                session.add(
                    WorkbenchChange(
                        owner_user_id=context["owner"], session_id=row.session_id, kind="session"
                    )
                )
        for locator, error_type in errors.items():
            checkpoint = await session.scalar(
                select(WorkbenchCheckpoint).where(
                    WorkbenchCheckpoint.source_id == source.id,
                    WorkbenchCheckpoint.locator == locator,
                )
            )
            if checkpoint is None:
                checkpoint = WorkbenchCheckpoint(source_id=source.id, locator=locator, state={})
                session.add(checkpoint)
            checkpoint.error = f"记录不可读或格式不支持（{error_type[:80]}）；未修改原始来源"
        failures = await session.scalar(
            select(func.count())
            .select_from(WorkbenchCheckpoint)
            .where(WorkbenchCheckpoint.source_id == source.id, WorkbenchCheckpoint.error != "")
        )
        mode = "原生事件" if native_events else ("原生 API 校准" if source.endpoint else "日志跟随")
        message = f"{mode} · 已发现 {len(locators)} 个记录"
        if failures:
            message += f" · {failures} 个记录暂不可读"
        if incomplete:
            message += " · 历史分批索引中"
        if any(locator not in present for _, locator, _, _ in known):
            message += " · 原生记录已消失，保留阅读副本"
        if source.message != message or source.status != ("partial" if failures else "following"):
            session.add(WorkbenchChange(owner_user_id=context["owner"], kind="source"))
        source.status = "partial" if failures else "following"
        source.message = message
        source.last_synced_at = utc_now()
        await session.execute(
            update(WorkbenchOperation)
            .where(WorkbenchOperation.source_id == source.id, WorkbenchOperation.status == "queued")
            .values(status="completed", message=message)
        )
        await session.commit()
