from __future__ import annotations

import asyncio
import logging
import time

import httpx
from sqlalchemy import delete, func, select, update
from watchfiles import awatch

from app.capabilities.agents.sessions import get_adapter
from app.runtime.config import get_settings
from app.runtime.db import SessionLocal
from app.runtime.ownership import bind_owner
from app.runtime.polling_runner import PollingTaskRunner
from app.runtime.time import utc_now

from ..models import WorkbenchChange, WorkbenchCheckpoint, WorkbenchOperation, WorkbenchSource
from .projection import apply_batch

logger = logging.getLogger(__name__)


class WorkbenchSyncRunner(PollingTaskRunner):
    runner_name = "agent-workbench-sync"
    poll_interval_seconds = 1

    def __init__(self, sessions=SessionLocal, *, actor_allowed):
        super().__init__()
        self.sessions = sessions
        self.actor_allowed = actor_allowed
        self.positions: dict[str, int] = {}
        self.endpoint_tasks: dict[str, asyncio.Task] = {}
        self.source_tasks: dict[str, tuple[int, asyncio.Task]] = {}
        self.endpoint_ready: dict[str, asyncio.Event] = {}
        self.scan_slots = asyncio.Semaphore(4)
        self.native_connected: set[str] = set()
        self.dirty: set[str] = set()
        self.last_poll: dict[str, float] = {}
        self.backoffs: dict[str, tuple[int, float]] = {}

    async def recover(self):
        # All persisted cursors are restartable; queued scans are safe to run again.
        return

    async def stop(self):
        await super().stop()
        tasks = [*self.endpoint_tasks.values(), *(task for _, task in self.source_tasks.values())]
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        self.endpoint_tasks.clear()
        self.source_tasks.clear()
        self.native_connected.clear()

    async def file_events(self, source_id, root):
        try:
            async for _changes in awatch(root, debounce=150, step=50):
                self.dirty.add(source_id)
        except (OSError, RuntimeError):
            return  # Periodic read-only reconciliation continues without a watcher.

    async def native_events(self, source_id, endpoint):
        try:
            async with httpx.AsyncClient(
                trust_env=False, follow_redirects=False, timeout=httpx.Timeout(30, read=35)
            ) as client:
                async with client.stream(
                    "GET", endpoint + "/event", headers={"Accept": "text/event-stream"}
                ) as response:
                    response.raise_for_status()
                    if "text/event-stream" not in response.headers.get("content-type", ""):
                        return
                    self.native_connected.add(source_id)
                    self.endpoint_ready[source_id].set()
                    async for line in response.aiter_lines():
                        if line.startswith("data:"):
                            self.dirty.add(source_id)
        except (httpx.HTTPError, OSError):
            pass
        finally:
            self.native_connected.discard(source_id)
            self.endpoint_ready[source_id].set()

    async def process_once(self):
        settings = get_settings()
        if not settings.fpl_agent_workbench_enabled:
            return
        async with self.sessions() as db:
            rows = list(
                (
                    await db.scalars(
                        select(WorkbenchSource).where(
                            WorkbenchSource.enabled.is_(True), WorkbenchSource.status != "unbound"
                        )
                    )
                ).all()
            )
            queued = set(
                (
                    await db.scalars(
                        select(WorkbenchOperation.source_id).where(
                            WorkbenchOperation.status == "queued"
                        )
                    )
                ).all()
            )
            allowed = {}
            for row in rows:
                if row.owner_user_id not in allowed:
                    allowed[row.owner_user_id] = await self.actor_allowed(db, row.owner_user_id)
            rows = [row for row in rows if allowed[row.owner_user_id]]
        active = {row.id for row in rows}
        for source_id in set(self.endpoint_tasks) - active:
            self.endpoint_tasks.pop(source_id).cancel()
        for source_id in set(self.source_tasks) - active:
            self.source_tasks.pop(source_id)[1].cancel()
        for source in rows:
            source_id = source.id
            running = self.source_tasks.get(source_id)
            if running and not running[1].done():
                if running[0] != source.revision:
                    running[1].cancel()
                continue
            failures, retry_at = self.backoffs.get(source_id, (0, 0))
            if source_id not in queued and time.monotonic() < retry_at:
                continue
            if source.endpoint:
                task = self.endpoint_tasks.get(source_id)
                if task is None or task.done():
                    self.endpoint_ready[source_id] = asyncio.Event()
                    self.endpoint_tasks[source_id] = asyncio.create_task(
                        self.native_events(source_id, source.endpoint)
                    )
                # Subscription is established before the initial snapshot. Events only
                # invalidate the snapshot; durable native message IDs remove overlap.
                if (
                    source_id not in queued
                    and source_id not in self.dirty
                    and time.monotonic() - self.last_poll.get(source_id, 0) < 5
                ):
                    continue
            elif (
                source_id not in queued
                and source_id not in self.dirty
                and time.monotonic() - self.last_poll.get(source_id, 0)
                < settings.fpl_agent_workbench_poll_seconds
            ):
                continue
            elif source_id not in self.endpoint_tasks or self.endpoint_tasks[source_id].done():
                self.endpoint_tasks[source_id] = asyncio.create_task(
                    self.file_events(source_id, source.root)
                )
            self.dirty.discard(source_id)
            task = asyncio.create_task(self.execute_scan(source, failures))
            self.source_tasks[source_id] = (source.revision, task)

    async def execute_scan(self, source, failures):
        async with self.scan_slots:
            try:
                if source.endpoint:
                    try:
                        await asyncio.wait_for(self.endpoint_ready[source.id].wait(), timeout=1)
                    except TimeoutError:
                        pass  # Fall back to API reconciliation until the stream is connected.
                await self.scan(source)
                self.backoffs.pop(source.id, None)
            except asyncio.CancelledError:
                raise
            except Exception as exc:
                failures += 1
                self.backoffs[source.id] = (
                    failures,
                    time.monotonic() + min(30, 2 ** min(failures, 5)),
                )
                logger.warning("Agent workbench source unavailable (%s)", type(exc).__name__)
                await self.finish(
                    source, "unavailable", "来源暂不可读；已保留同步副本，请检查路径、版本或端点"
                )
            self.last_poll[source.id] = time.monotonic()

    async def scan(self, source):
        adapter = get_adapter(source.agent_id, source.endpoint)
        locators = await asyncio.to_thread(adapter.discover, source.root)
        missing_message = "原生记录已消失，保留最后同步的阅读副本"
        async with self.sessions() as db:
            bind_owner(db, source.owner_user_id)
            current = await db.get(WorkbenchSource, source.id)
            if not current or not current.enabled or current.revision != source.revision:
                return
            known = (
                await db.execute(
                    select(
                        WorkbenchCheckpoint.id,
                        WorkbenchCheckpoint.locator,
                        WorkbenchCheckpoint.error,
                        WorkbenchCheckpoint.session_id,
                    ).where(WorkbenchCheckpoint.source_id == source.id)
                )
            ).all()
            present = set(locators)
            repaired = 0
            for key, locator, error, session_id in known:
                if locator not in present and session_id is None:
                    await db.execute(
                        delete(WorkbenchCheckpoint).where(WorkbenchCheckpoint.id == key)
                    )
                    continue
                message = (
                    missing_message
                    if locator not in present
                    else ("" if error == missing_message else error)
                )
                if message != error:
                    if repaired >= 200:
                        break
                    repaired += 1
                    await db.execute(
                        update(WorkbenchCheckpoint)
                        .where(WorkbenchCheckpoint.id == key)
                        .values(error=message)
                    )
                    db.add(
                        WorkbenchChange(
                            owner_user_id=source.owner_user_id,
                            session_id=session_id,
                            kind="session",
                        )
                    )
            await db.commit()
        budget = get_settings().fpl_agent_workbench_files_per_pass
        position = self.positions.get(source.id, 0)
        # Follow recent activity every pass while advancing through cold histories.
        hot = min(20, budget // 2)
        cold = locators[hot:]
        count = max(1, budget - hot)
        offset = position % max(1, len(cold))
        selected = list(
            dict.fromkeys(locators[:hot] + (cold + cold)[offset : offset + min(count, len(cold))])
        )
        self.positions[source.id] = position + count
        async with self.sessions() as db:
            bind_owner(db, source.owner_user_id)
            checkpoints = {
                row.locator: row.state
                for row in (
                    await db.scalars(
                        select(WorkbenchCheckpoint).where(
                            WorkbenchCheckpoint.source_id == source.id,
                            WorkbenchCheckpoint.locator.in_(selected),
                        )
                    )
                ).all()
            }
        failures = 0
        incomplete = False
        for locator in selected:
            previous = checkpoints.get(locator, {})
            try:
                batch = await asyncio.to_thread(adapter.watch, source.root, locator, previous)
                incomplete = incomplete or not batch.complete
                if batch.checkpoint != previous:
                    await apply_batch(
                        self.sessions,
                        source.id,
                        source.owner_user_id,
                        source.revision,
                        locator,
                        previous,
                        batch,
                    )
            except (OSError, ValueError, KeyError, TypeError) as exc:
                failures += 1
                await self.record_error(source, locator, type(exc).__name__)
        mode = (
            "原生事件"
            if source.id in self.native_connected
            else ("原生 API 校准" if source.endpoint else "日志跟随")
        )
        async with self.sessions() as db:
            bind_owner(db, source.owner_user_id)
            indexed = (
                await db.scalar(
                    select(func.count(WorkbenchCheckpoint.id)).where(
                        WorkbenchCheckpoint.source_id == source.id,
                        WorkbenchCheckpoint.session_id.is_not(None),
                        WorkbenchCheckpoint.state["complete"].as_boolean().is_not(False),
                    )
                )
                or 0
            )
            missing = sum(1 for _, locator, _, _ in known if locator not in present)
            total_errors = (
                await db.scalar(
                    select(func.count(WorkbenchCheckpoint.id)).where(
                        WorkbenchCheckpoint.source_id == source.id, WorkbenchCheckpoint.error != ""
                    )
                )
                or 0
            )
        failures = max(failures, total_errors)
        incomplete = incomplete or indexed < len(locators)
        status = "partial" if failures else "following"
        message = f"{mode} · 已发现 {len(locators)} 个记录" + (
            f" · {failures} 个记录暂不可读" if failures else ""
        )
        if incomplete:
            message += " · 历史分批索引中"
        if missing:
            message += f" · {missing} 个原生记录已消失，保留阅读副本"
        await self.finish(source, status, message)

    async def record_error(self, source, locator, error_type):
        async with self.sessions() as db:
            bind_owner(db, source.owner_user_id)
            current = await db.get(WorkbenchSource, source.id)
            if not current or not current.enabled or current.revision != source.revision:
                return
            row = await db.scalar(
                select(WorkbenchCheckpoint).where(
                    WorkbenchCheckpoint.source_id == source.id,
                    WorkbenchCheckpoint.locator == locator,
                )
            )
            if row is None:
                row = WorkbenchCheckpoint(source_id=source.id, locator=locator, state={})
                db.add(row)
            row.error = f"记录不可读或格式不支持（{error_type}）；未修改原始来源"
            await db.commit()

    async def finish(self, source, status, message):
        async with self.sessions() as db:
            bind_owner(db, source.owner_user_id)
            row = await db.scalar(
                select(WorkbenchSource).where(
                    WorkbenchSource.id == source.id,
                    WorkbenchSource.owner_user_id == source.owner_user_id,
                )
            )
            if row is None or row.revision != source.revision or not row.enabled:
                return
            if row.status != status or row.message != message:
                db.add(WorkbenchChange(owner_user_id=source.owner_user_id, kind="source"))
            row.status = status
            row.message = message
            if status != "unavailable":
                row.last_synced_at = utc_now()
            await db.execute(
                update(WorkbenchOperation)
                .where(
                    WorkbenchOperation.source_id == source.id,
                    WorkbenchOperation.owner_user_id == source.owner_user_id,
                    WorkbenchOperation.status == "queued",
                )
                .values(
                    status="failed" if status == "unavailable" else "completed", message=message
                )
            )
            await db.commit()
