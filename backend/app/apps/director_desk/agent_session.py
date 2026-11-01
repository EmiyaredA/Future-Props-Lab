"""In-process bridge from an external tool call to the open WebGL editor."""

from __future__ import annotations

import asyncio
import secrets
from dataclasses import dataclass, field
from typing import Any

from app.apps.director_desk.projects import DirectorDeskError, DirectorDeskProjects
from app.orm import bind_owner
from app.runtime.db import SessionLocal

WAIT_SECONDS = 30
READ_TOOLS = frozenset(
    {
        "director_assets",
        "director_continuity",
        "director_help",
        "director_motions",
        "director_nodes",
        "director_path_surface",
        "director_read",
        "director_skill",
        "director_spatial",
        "director_stride",
    }
)
WRITE_TOOLS = frozenset(
    {
        "director_apply",
        "director_export",
        "director_history",
        "director_scan",
        "director_view",
    }
)
KNOWN_TOOLS = READ_TOOLS | WRITE_TOOLS | {"director_job", "director_media", "director_scene"}


class EditorClosed(DirectorDeskError):
    def __init__(self) -> None:
        super().__init__("工程未打开", 409, "editor_not_open")


def needs_write(name: str, arguments: dict[str, Any]) -> bool:
    if name in WRITE_TOOLS:
        return True
    action = arguments.get("action")
    if name == "director_media":
        return action not in {"list", "surfaces"}
    if name == "director_scene":
        return action not in {"list", "read"}
    if name == "director_job":
        return bool(arguments.get("cancel"))
    return False


async def require_project(owner_user_id: str, project_id: str) -> None:
    async with SessionLocal() as session:
        bind_owner(session, owner_user_id)
        await DirectorDeskProjects(session, owner_user_id).row(project_id)


@dataclass
class _Call:
    id: str
    request_id: str
    name: str
    arguments: dict[str, Any]
    future: asyncio.Future[Any]


@dataclass
class _Session:
    session_id: str
    closed: bool = False
    queue: asyncio.Queue[_Call | None] = field(default_factory=asyncio.Queue)
    pending: dict[str, _Call] = field(default_factory=dict)
    by_call: dict[str, _Call] = field(default_factory=dict)
    completed: dict[str, Any] = field(default_factory=dict)
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)


_sessions: dict[tuple[str, str], _Session] = {}
_guard = asyncio.Lock()


def _fail(session: _Session) -> None:
    session.closed = True
    while not session.queue.empty():
        try:
            session.queue.get_nowait()
        except asyncio.QueueEmpty:
            break
    session.queue.put_nowait(None)
    for call in session.pending.values():
        if not call.future.done():
            call.future.set_exception(EditorClosed())
    session.pending.clear()
    session.by_call.clear()


async def claim(owner_user_id: str, project_id: str) -> str:
    await require_project(owner_user_id, project_id)
    session_id = secrets.token_hex(16)
    async with _guard:
        previous = _sessions.get((owner_user_id, project_id))
        if previous is not None:
            _fail(previous)
        _sessions[(owner_user_id, project_id)] = _Session(session_id)
    return session_id


async def release(owner_user_id: str, project_id: str, session_id: str) -> None:
    await require_project(owner_user_id, project_id)
    async with _guard:
        current = _sessions.get((owner_user_id, project_id))
        if current is None or current.session_id != session_id:
            return
        _fail(current)
        _sessions.pop((owner_user_id, project_id), None)


def _current(owner_user_id: str, project_id: str, session_id: str) -> _Session:
    current = _sessions.get((owner_user_id, project_id))
    if current is None or current.closed or current.session_id != session_id:
        raise EditorClosed()
    return current


async def poll(owner_user_id: str, project_id: str, session_id: str, wait: float) -> _Call | None:
    await require_project(owner_user_id, project_id)
    session = _current(owner_user_id, project_id, session_id)
    try:
        item = await asyncio.wait_for(session.queue.get(), max(wait, 0.01))
    except TimeoutError:
        if session.closed or session.session_id != session_id:
            raise EditorClosed() from None
        return None
    if item is None or session.closed or session.session_id != session_id:
        raise EditorClosed()
    return item


async def complete(
    owner_user_id: str,
    project_id: str,
    session_id: str,
    call_id: str,
    *,
    result: Any = None,
    error: str | None = None,
) -> None:
    await require_project(owner_user_id, project_id)
    session = _current(owner_user_id, project_id, session_id)
    call = session.by_call.get(call_id)
    if call is None or call.future.done():
        raise DirectorDeskError("工具调用不存在或已结束", 404, "call_not_found")
    session.pending.pop(call.request_id, None)
    session.by_call.pop(call_id, None)
    if error:
        if error.startswith("REVISION_CONFLICT"):
            call.future.set_exception(DirectorDeskError(error, 409, "revision_conflict"))
        else:
            call.future.set_exception(DirectorDeskError(error, 422, "tool_rejected"))
        return
    session.completed[call.request_id] = result
    if len(session.completed) > 50:
        session.completed.pop(next(iter(session.completed)))
    call.future.set_result(result)


async def invoke(
    owner_user_id: str, project_id: str, name: str, arguments: dict[str, Any], request_id: str
) -> Any:
    if name not in KNOWN_TOOLS:
        raise DirectorDeskError("未知的导演台工具", 422, "unknown_tool")
    await require_project(owner_user_id, project_id)
    async with _guard:
        session = _sessions.get((owner_user_id, project_id))
        if session is None or session.closed:
            raise EditorClosed()
    async with session.lock:
        if session.closed:
            raise EditorClosed()
        if request_id in session.completed:
            return session.completed[request_id]
        existing = session.pending.get(request_id)
        if existing is None:
            call = _Call(
                id=secrets.token_hex(16),
                request_id=request_id,
                name=name,
                arguments=arguments,
                future=asyncio.get_running_loop().create_future(),
            )
            session.pending[request_id] = call
            session.by_call[call.id] = call
            session.queue.put_nowait(call)
            existing = call
        future = existing.future
    try:
        return await asyncio.wait_for(asyncio.shield(future), WAIT_SECONDS)
    except TimeoutError:
        async with session.lock:
            stale = session.pending.get(request_id)
            if stale is not None and stale.future is future and not future.done():
                session.pending.pop(request_id, None)
                session.by_call.pop(stale.id, None)
                future.cancel()
        raise DirectorDeskError("编辑器没有在时限内返回", 504, "editor_timeout") from None
    except EditorClosed:
        raise
    except DirectorDeskError:
        raise
