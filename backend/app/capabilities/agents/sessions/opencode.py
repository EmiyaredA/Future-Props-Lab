"""Read-only OpenCode storage and explicitly selected loopback server."""

from __future__ import annotations

import json
import sqlite3
from dataclasses import asdict
from datetime import UTC, datetime
from pathlib import Path

import httpx

from .attachments import reference
from .contracts import Entry, ReadBatch, SessionInfo
from .files import discover_files, safe_path
from .parsers import text, timestamp


def entries(messages):
    result = []
    for message_index, message in enumerate(messages):
        info = message.get("info", {})
        role = info.get("role", "assistant")
        at = timestamp(info.get("time", {}).get("created"))
        for index, part in enumerate(message.get("parts", [])):
            kind = part.get("type", "")
            key = str(part.get("id") or f"{info.get('id', message_index)}:{index}")
            order = int(info.get("time", {}).get("created", message_index)) * 1000 + index
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
                result.append(
                    Entry(
                        key,
                        order,
                        "tool",
                        "tool_result"
                        if state.get("status") in {"completed", "error"}
                        else "tool_call",
                        json.dumps(state.get("input", {}), ensure_ascii=False)
                        + "\n"
                        + text(state.get("output", state.get("error", ""))),
                        at,
                        tool_name=part.get("tool", ""),
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
        if checkpoint.get("fingerprint") == fingerprint:
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
            {"fingerprint": fingerprint, "info": asdict(info)},
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
