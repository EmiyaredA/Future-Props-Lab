"""Runner-owned, bounded telemetry sockets. HTTP remains the completion authority."""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from datetime import UTC
from time import monotonic
from typing import Any
from urllib.parse import urlencode, urlsplit, urlunsplit

from websockets.asyncio.client import connect

from app.llm.task_execution import TaskExecutionInfo
from app.runtime.outbound_urls import require_safe_provider_websocket_url
from studio.runtime.time import utc_now


def apply_event(info: TaskExecutionInfo, message: dict, task_id: str) -> TaskExecutionInfo:
    """Never accept unscoped, cross-task or binary preview events."""
    data = message.get("data")
    if not isinstance(data, dict) or data.get("prompt_id") != task_id:
        return info
    kind = message.get("type")
    values: dict[str, Any] = {}
    node = data.get("node")
    if kind == "progress_state" and isinstance(data.get("nodes"), dict):
        current = next(
            (
                (key, value)
                for key, value in data["nodes"].items()
                if isinstance(value, dict) and value.get("state") == "running"
            ),
            None,
        )
        if current:
            node, data = current
    if kind in {"executing", "progress", "progress_state"}:
        if node is None:
            if kind != "executing":
                return info
            values.update(phase="finalizing", node_id=None, step=None, total_steps=None)
        elif isinstance(node, (str, int)) and not isinstance(node, bool):
            node = str(node)[:128]
            values.update(phase="running", node_id=node)
            if node != info.node_id:
                values.update(step=None, total_steps=None, node_label=None)
            value, maximum = data.get("value"), data.get("max")
            if (
                type(value) is int
                and type(maximum) is int
                and 0 <= value <= maximum
                and 0 < maximum <= 1_000_000
            ):
                values.update(step=value, total_steps=maximum)
        else:
            return info
    else:
        # Completion/error events are deliberately settled through the result API.
        return info
    return info.model_copy(update={**values, "last_event_at": utc_now().replace(tzinfo=UTC)})


@dataclass
class _Subscription:
    info: TaskExecutionInfo
    touched: float = field(default_factory=monotonic)
    worker: asyncio.Task | None = None


class ZealmanLiveMonitor:
    """An explicit runner resource, with no process-global or cross-runner cache."""

    def __init__(self) -> None:
        self._subscriptions: dict[tuple[str, str], _Subscription] = {}

    def observe(
        self,
        *,
        root: str,
        api_key: str,
        task_id: str,
        client_id: str,
        info: TaskExecutionInfo,
        graph: dict,
    ) -> TaskExecutionInfo:
        # Old console-owned IDs must not be reused: ComfyUI replaces that socket.
        if not client_id.startswith("fpl-") or len(client_id) > 128:
            return info
        key = (root, task_id)
        for old_key, old in list(self._subscriptions.items()):
            if monotonic() - old.touched > 60:
                if old.worker:
                    old.worker.cancel()
                del self._subscriptions[old_key]
        sub = self._subscriptions.get(key)
        if sub is None:
            if len(self._subscriptions) >= 40:
                return info
            sub = _Subscription(info=info.model_copy(update={"live_status": "connecting"}))
            self._subscriptions[key] = sub
            sub.worker = asyncio.create_task(self._listen(root, api_key, task_id, client_id, sub))
        sub.touched = monotonic()
        live = sub.info
        values: dict[str, Any] = {
            "live_status": live.live_status,
            "last_event_at": live.last_event_at,
        }
        if live.last_event_at and info.phase in {"running", "finalizing"}:
            values.update(node_id=live.node_id, step=live.step, total_steps=live.total_steps)
            # HTTP execution state wins after a restart or completion.
            if info.phase == "running" and live.phase == "finalizing":
                values["phase"] = "finalizing"
            node = graph.get(live.node_id, {})
            if isinstance(node, dict) and isinstance(node.get("class_type"), str):
                # Only class type; never expose input values, URLs or user metadata.
                values["node_label"] = node["class_type"][:128]
        return info.model_copy(update=values)

    async def forget(self, root: str, task_id: str) -> None:
        sub = self._subscriptions.pop((root, task_id), None)
        if sub and sub.worker:
            sub.worker.cancel()
            await asyncio.gather(sub.worker, return_exceptions=True)

    async def close(self) -> None:
        workers = [sub.worker for sub in self._subscriptions.values() if sub.worker]
        self._subscriptions.clear()
        for worker in workers:
            worker.cancel()
        await asyncio.gather(*workers, return_exceptions=True)

    async def _listen(
        self,
        root: str,
        api_key: str,
        task_id: str,
        client_id: str,
        sub: _Subscription,
    ) -> None:
        parsed = urlsplit(root)
        url = require_safe_provider_websocket_url(
            urlunsplit(
                (
                    "wss" if parsed.scheme == "https" else "ws",
                    parsed.netloc,
                    parsed.path.rstrip("/") + "/comfyui-ws",
                    urlencode({"clientId": client_id}),
                    "",
                )
            )
        )
        delay = 1
        while monotonic() - sub.touched <= 60:
            try:
                async with connect(
                    url,
                    additional_headers={"Authorization": f"Bearer {api_key}"} if api_key else {},
                    open_timeout=8,
                    close_timeout=2,
                    max_size=2 * 1024 * 1024,
                    max_queue=8,
                ) as socket:
                    sub.info = sub.info.model_copy(update={"live_status": "connected"})
                    delay = 1
                    while monotonic() - sub.touched <= 60:
                        try:
                            raw = await asyncio.wait_for(socket.recv(), timeout=15)
                        except TimeoutError:
                            continue
                        if not isinstance(raw, str):
                            continue
                        try:
                            message = json.loads(raw)
                        except ValueError:
                            continue
                        if isinstance(message, dict):
                            sub.info = apply_event(sub.info, message, task_id)
            except asyncio.CancelledError:
                raise
            except Exception:
                # Optional telemetry cannot fail or resubmit the paid task.
                sub.info = sub.info.model_copy(update={"live_status": "reconnecting"})
                await asyncio.sleep(delay)
                delay = min(delay * 2, 30)
