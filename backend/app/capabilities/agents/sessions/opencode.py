"""Read-only OpenCode storage and explicitly selected loopback server."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

from app.capabilities.agents.activity import tool_details

from .attachments import reference
from .contracts import Entry, ReadBatch, SessionInfo
from .files import discover_files, safe_path
from .parsers import native_id, text, timestamp


def entries(messages):
    result = []
    ordered = sorted(
        messages,
        key=lambda message: (
            timestamp(message.get("info", {}).get("time", {}).get("created")),
            message.get("info", {}).get("id") or "",
        ),
    )
    for message_index, message in enumerate(ordered):
        info = message.get("info", {})
        role = info.get("role", "assistant")
        presentation = {
            "message_id": native_id(info.get("id")),
            "turn_id": native_id(info.get("id") if role == "user" else info.get("parentID")),
        }
        start = len(result)
        at = timestamp(info.get("time", {}).get("created"))
        for index, part in enumerate(message.get("parts", [])):
            kind = part.get("type", "")
            key = str(part.get("id") or f"{info.get('id', message_index)}:{index}")
            order = len(result)
            if kind in {"text", "reasoning"}:
                result.append(
                    Entry(
                        key,
                        order,
                        role,
                        "thinking" if kind == "reasoning" else "message",
                        text(part.get("text", "")),
                        at,
                    )
                )
            elif kind == "tool":
                state = part.get("state", {})
                status = {
                    "error": "failed",
                    "completed": "completed",
                    "running": "running",
                    "pending": "pending",
                }.get(state.get("status"))
                name = part.get("tool") or ""
                timing = state.get("time") or {}
                start_time, end_time = timing.get("start"), timing.get("end")
                elapsed = (
                    end_time - start_time
                    if type(start_time) is int and type(end_time) is int
                    else None
                )
                details = tool_details(
                    name, state.get("input"), result=state.get("output"), duration=elapsed
                )
                arguments = json.dumps(state.get("input", {}), ensure_ascii=False)
                output = text(state.get("output", state.get("error", "")))
                blocks = [
                    {
                        "kind": "tool_call",
                        "text": arguments,
                        "tool_name": name,
                        "call_id": key,
                        "status": status,
                        "details": details,
                    }
                ]
                if status in {"completed", "failed"}:
                    blocks.append(
                        {
                            "kind": "tool_result",
                            "text": output,
                            "tool_name": name,
                            "call_id": key,
                            "status": status,
                        }
                    )
                result.append(
                    Entry(
                        key,
                        order,
                        "tool",
                        "tool_result" if len(blocks) == 2 else "tool_call",
                        "\n".join(filter(None, (arguments, output))),
                        at,
                        tool_name=name,
                        presentation={"status": status, "blocks": blocks},
                    )
                )
            elif kind == "file":
                result.append(
                    Entry(
                        key,
                        order,
                        role,
                        "message",
                        "[文件引用] " + str(part.get("filename", "")),
                        at,
                        attachments=reference(part.get("url", "")),
                    )
                )
        for entry in result[start:]:
            entry.presentation.update(presentation)
    return result


def session_info(row):
    time = row.get("time", {})
    return SessionInfo(
        native_id=row["id"],
        title=row.get("title", ""),
        cwd=row.get("directory", ""),
        parent_id=row.get("parentID", row.get("parent_id")),
        archived=bool(time.get("archived", row.get("time_archived"))),
        updated_at=timestamp(time.get("updated", row.get("time_updated"))),
    )


class OpenCodeAdapter:
    def get_capabilities(self):
        return {"browse": True, "follow": True, "send": False, "mode": "log_follow"}

    def discover(self, root):
        locators = []
        for relative in discover_files(root, (".db", ".sqlite")):
            path = safe_path(root, relative)
            with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1) as conn:
                tables = {
                    row[0]
                    for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
                }
                if not {"session", "message", "part"} <= tables:
                    continue
                for row in conn.execute(
                    "SELECT id FROM session ORDER BY time_updated DESC LIMIT 20000"
                ):
                    locators.append(json.dumps([relative, row[0]]))
        return locators

    def read_history(self, root, locator, checkpoint):
        relative, native_id = json.loads(locator)
        path = safe_path(root, relative)
        # WAL changes matter even when the main SQLite file has not changed.
        fingerprint = ":".join(
            str(p.stat().st_mtime_ns) for p in (path, Path(str(path) + "-wal")) if p.exists()
        )
        if checkpoint.get("fingerprint") == fingerprint and checkpoint.get("presentation") == 2:
            return ReadBatch(SessionInfo(**checkpoint["info"]), [], checkpoint)
        with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True, timeout=1) as conn:
            conn.row_factory = sqlite3.Row
            conn.execute("BEGIN")
            row = conn.execute("SELECT * FROM session WHERE id=?", (native_id,)).fetchone()
            if row is None:
                raise FileNotFoundError("原生会话已移除")
            info = session_info(dict(row))
            rows = conn.execute(
                "SELECT * FROM message WHERE session_id=? ORDER BY time_created,id", (native_id,)
            ).fetchall()
            parts = {}
            for item in conn.execute(
                "SELECT * FROM part WHERE session_id=? ORDER BY time_created,id", (native_id,)
            ):
                parts.setdefault(item["message_id"], []).append(
                    {**json.loads(item["data"]), "id": item["id"]}
                )
            messages = [
                {
                    "info": {
                        **json.loads(item["data"]),
                        "id": item["id"],
                        "time": {"created": item["time_created"]},
                    },
                    "parts": parts.get(item["id"], []),
                }
                for item in rows
            ]
        return ReadBatch(
            info,
            entries(messages),
            {"fingerprint": fingerprint, "info": asdict(info), "presentation": 2},
            reset=bool(checkpoint),
        )

    def watch(self, root, locator, checkpoint):
        return self.read_history(root, locator, checkpoint)


class OpenCodeServerAdapter:
    def __init__(self, endpoint: str):
        self.endpoint = endpoint.rstrip("/")

    def get_capabilities(self):
        return {"browse": True, "follow": True, "send": False, "mode": "native_events"}

    def get(self, path):
        with httpx.Client(
            base_url=self.endpoint, timeout=10, trust_env=False, follow_redirects=False
        ) as client:
            with client.stream("GET", path) as response:
                response.raise_for_status()
                chunks = bytearray()
                for chunk in response.iter_bytes():
                    chunks.extend(chunk)
                    if len(chunks) > 32 * 1024 * 1024:
                        raise ValueError("原生响应超过读取上限")
                return json.loads(chunks)

    def discover(self, _root):
        if self.get("/global/health").get("healthy") is not True:
            raise ValueError("端点不是可读 OpenCode 实例")
        return [row["id"] for row in self.get("/session")[:20000]]

    def read_history(self, _root, locator, checkpoint):
        from urllib.parse import quote

        path = "/session/" + quote(locator, safe="")
        info = session_info(self.get(path))
        events = entries(self.get(path + "/message"))
        return ReadBatch(
            info,
            events,
            {"info": asdict(info), "read_at": datetime.now(UTC).isoformat()},
            reset=bool(checkpoint),
        )

    def watch(self, root, locator, checkpoint):
        return self.read_history(root, locator, checkpoint)
