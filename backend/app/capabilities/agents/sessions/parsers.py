"""Vendor records become display entries; request blobs, credentials and instructions stay out."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.capabilities.agents.activity import positive_int, question_answers, tool_details

from .attachments import reference
from .contracts import Entry, SessionInfo


def timestamp(value) -> str:
    if isinstance(value, (int, float)):
        try:
            return (
                datetime.fromtimestamp(value / (1000 if value > 10**11 else 1), UTC)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            )
        except (ValueError, OverflowError, OSError):
            return ""
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return (
                parsed.replace(tzinfo=parsed.tzinfo or UTC)
                .astimezone(UTC)
                .isoformat(timespec="milliseconds")
                .replace("+00:00", "Z")
            )
        except ValueError:
            return ""
    return ""


def text(value) -> str:
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        return "\n".join(filter(None, (text(item) for item in value)))
    if isinstance(value, dict):
        kind = value.get("type", "")
        if kind in {"image", "image_url", "input_image"}:
            return "[图片引用]"
        return text(value.get("text", value.get("content", "")))
    return ""


def origin(info: SessionInfo, kind: str, evidence: str):
    if kind not in info.origins:
        info.origins.append(kind)
    if evidence not in info.evidence:
        info.evidence.append(evidence)


def update(info, entry):
    if entry.timestamp and entry.timestamp > info.updated_at:
        info.updated_at = entry.timestamp
    if not info.title and entry.role == "user" and entry.kind == "message":
        info.title = entry.text.strip().split("\n")[0][:120] if entry.text.strip() else ""
    return entry


def native_id(value):
    return value if isinstance(value, str) and value else None


def answer_details(value):
    answers = question_answers(value)
    return {"details": {"kind": "question", "answers": answers}} if answers else {}


def duration_entry(key, ordinal, at, turn_id, duration):
    duration = positive_int(duration)
    return (
        [
            Entry(
                key,
                ordinal,
                "assistant",
                "duration",
                "",
                at,
                presentation={
                    "turn_id": turn_id,
                    "details": {"kind": "duration", "duration_ms": duration},
                },
            )
        ]
        if duration
        else []
    )


def blocks(content, *, key, ordinal, role, at, parent=None):
    result = content_blocks(content, key=key, ordinal=ordinal, role=role, at=at, parent=parent)
    for entry in result:
        entry.presentation["message_id"] = key
    return result


def content_blocks(content, *, key, ordinal, role, at, parent):
    if isinstance(content, str):
        return [Entry(key, ordinal, role, "message", content, at, parent)]
    result = []
    for index, block in enumerate(content or []):
        if not isinstance(block, dict):
            continue
        kind = block.get("type", "")
        block_id = f"{key}:{index}"
        if kind in {"text", "input_text", "output_text", "thinking"}:
            result.append(
                Entry(
                    block_id,
                    ordinal + index,
                    role,
                    "thinking" if kind == "thinking" else "message",
                    text(block.get("text", block.get("thinking", ""))),
                    at,
                    parent,
                )
            )
        elif kind in {"tool_use", "toolCall"}:
            result.append(
                Entry(
                    block_id,
                    ordinal + index,
                    "assistant",
                    "tool_call",
                    json.dumps(block.get("input", block.get("arguments", {})), ensure_ascii=False),
                    at,
                    parent,
                    block.get("name") or "",
                    presentation={
                        "call_id": native_id(block.get("id")),
                        "details": tool_details(
                            block.get("name"), block.get("input", block.get("arguments"))
                        ),
                    },
                )
            )
        elif kind == "tool_result":
            result.append(
                Entry(
                    block_id,
                    ordinal + index,
                    "tool",
                    "tool_result",
                    text(block.get("content")),
                    at,
                    parent,
                    presentation={
                        "call_id": native_id(block.get("tool_use_id")),
                        "status": "failed" if block.get("is_error") is True else None,
                        **answer_details(block.get("content")),
                    },
                )
            )
        elif kind in {"image", "image_url", "input_image", "file"}:
            result.append(
                Entry(
                    block_id,
                    ordinal + index,
                    role,
                    "message",
                    "[附件引用]",
                    at,
                    parent,
                    attachments=reference(
                        block.get("path", block.get("url", block.get("image_url", "")))
                    ),
                )
            )
    return result


def codex(record, ordinal, info, _locator):
    payload = record.get("payload", {})
    kind = record.get("type")
    at = timestamp(record.get("timestamp"))
    if kind == "session_meta":
        info.native_id = payload.get("id", "")
        info.cwd = payload.get("cwd", "")
        info.parent_id = payload.get("parent_thread_id")
        source = payload.get("source")
        creator = str(payload.get("originator", ""))
        if "desktop" in creator.lower():
            origin(info, "app", f"originator={creator}")
        elif source in ("cli", "exec") or creator in {"codex_cli_rs", "codex_exec"}:
            origin(info, "cli", f"source={source}; originator={creator}")
        return []
    if kind == "turn_context":
        info.model = payload.get("model", "")
        info.turn_id = native_id(payload.get("turn_id")) or info.turn_id
        return []
    if kind == "event_msg":
        event = payload.get("type")
        if event in {"task_started", "turn_started"}:
            info.turn_id = native_id(payload.get("turn_id"))
        elif event in {"task_complete", "turn_completed", "turn_aborted"}:
            turn_id, info.turn_id = native_id(payload.get("turn_id")) or info.turn_id, None
            return duration_entry(
                f"duration:{ordinal}", ordinal, at, turn_id, payload.get("duration_ms")
            )
        return []
    if kind != "response_item":
        return []
    key = str(payload.get("id") or payload.get("call_id") or f"record:{ordinal}")
    ptype = payload.get("type")
    if ptype == "message":
        entries = blocks(
            payload.get("content"),
            key=key,
            ordinal=ordinal,
            role=payload.get("role", "assistant"),
            at=at,
        )
    elif ptype in {"function_call", "custom_tool_call"}:
        entries = [
            Entry(
                f"call:{key}",
                ordinal,
                "assistant",
                "tool_call",
                str(payload.get("arguments", payload.get("input", ""))),
                at,
                tool_name=payload.get("name") or "",
                presentation={
                    "call_id": native_id(payload.get("call_id")),
                    "details": tool_details(
                        payload.get("name"), payload.get("arguments", payload.get("input"))
                    ),
                },
            )
        ]
    elif ptype == "web_search_call":
        action = payload.get("action")
        action = action if isinstance(action, dict) else {}
        entries = [
            Entry(
                f"web:{key}",
                ordinal,
                "assistant",
                "tool_call",
                "",
                at,
                tool_name="web_search",
                presentation={
                    "details": tool_details("web_search", action),
                    "status": "completed" if payload.get("status") == "completed" else None,
                },
            )
        ]
    elif ptype in {"function_call_output", "custom_tool_call_output"}:
        entries = [
            Entry(
                f"result:{key}",
                ordinal,
                "tool",
                "tool_result",
                text(payload.get("output")),
                at,
                presentation={
                    "call_id": native_id(payload.get("call_id")),
                    **answer_details(payload.get("output")),
                },
            )
        ]
    else:
        entries = []
    for entry in entries:
        entry.presentation["turn_id"] = native_id(payload.get("turn_id")) or info.turn_id
    return [update(info, entry) for entry in entries]


def claude(record, ordinal, info, locator):
    if record.get("sessionId") and not info.native_id:
        info.native_id = record["sessionId"]
        if record.get("isSidechain") or "/subagents/" in locator:
            info.parent_id = info.native_id
            info.native_id += "/" + Path(locator).stem
    info.cwd = record.get("cwd") or info.cwd
    entrypoint = str(record.get("entrypoint", ""))
    if "desktop" in entrypoint:
        origin(info, "app", f"entrypoint={entrypoint}")
    elif entrypoint in {"cli", "sdk-cli", "claude-cli"}:
        origin(info, "cli", f"entrypoint={entrypoint}")
    if record.get("type") in {"custom-title", "ai-title"}:
        info.title = str(record.get("customTitle", record.get("aiTitle", "")))[:120]
    if record.get("type") not in {"user", "assistant"}:
        return []
    message = record.get("message", {})
    if not isinstance(message, dict):
        return []
    info.model = message.get("model") or info.model
    entries = blocks(
        message.get("content"),
        key=str(record.get("uuid") or f"record:{ordinal}"),
        ordinal=ordinal,
        role=message.get("role", record["type"]),
        at=timestamp(record.get("timestamp")),
        parent=record.get("parentUuid"),
    )
    tool_result = record.get("toolUseResult")
    results = [entry for entry in entries if entry.kind == "tool_result"]
    if len(results) == 1 and isinstance(tool_result, dict):
        details = answer_details(tool_result).get("details")
        duration = positive_int(tool_result.get("durationMs"))
        if details or duration:
            results[0].presentation["details"] = {
                **(details or results[0].presentation.get("details") or {"kind": "duration"}),
                "duration_ms": duration,
            }
    return [update(info, entry) for entry in entries]


def pi(record, ordinal, info, _locator):
    kind = record.get("type")
    if kind == "session":
        if record.get("version", 0) not in {1, 2, 3}:
            raise ValueError("Pi 会话版本不支持；请在原端确认格式")
        info.native_id = record.get("id", "")
        info.cwd = record.get("cwd", "")
        # Pi session headers do not prove which application hosted the RPC/TUI.
        return []
    if kind == "session_info":
        info.title = str(record.get("name", ""))[:120]
    if kind == "model_change":
        info.model = record.get("modelId", "")
    key = str(record.get("id") or f"record:{ordinal}")
    parent = record.get("parentId")
    at = timestamp(record.get("timestamp"))
    if kind in {"compaction", "branch_summary"}:
        return [
            update(
                info,
                Entry(key, ordinal, "system", kind, str(record.get("summary", "")), at, parent),
            )
        ]
    if kind != "message":
        return [Entry(key, ordinal, "system", "branch_metadata", "", at, parent)]
    message = record.get("message", {})
    role = message.get("role", "assistant")
    info.model = message.get("model") or info.model
    if role in {"toolResult", "bashExecution"}:
        return [
            update(
                info,
                Entry(
                    key,
                    ordinal,
                    "tool",
                    "tool_result",
                    text(message.get("content", message.get("output", ""))),
                    at,
                    parent,
                    message.get("toolName") or "",
                    presentation={
                        "call_id": native_id(message.get("toolCallId")),
                        "status": "failed" if message.get("isError") is True else None,
                        **(
                            answer_details(message.get("details"))
                            if role == "toolResult"
                            else {
                                "details": tool_details(
                                    "bash",
                                    {"command": message.get("command")},
                                    duration=message.get("durationMs"),
                                )
                            }
                        ),
                    },
                ),
            )
        ]
    entries = blocks(
        message.get("content"), key=key, ordinal=ordinal, role=role, at=at, parent=parent
    )
    # One node per native record: branch parents refer to record IDs, not blocks.
    if not entries:
        return [Entry(key, ordinal, role, "branch_metadata", "", at, parent)]
    combined = Entry(
        key,
        ordinal,
        role,
        "tool_call" if any(e.kind == "tool_call" for e in entries) else "message",
        "\n".join(e.text for e in entries),
        at,
        parent,
        next((e.tool_name for e in entries if e.tool_name), ""),
        attachments=[attachment for entry in entries for attachment in entry.attachments],
        presentation={
            "message_id": key,
            "blocks": [
                {
                    "kind": e.kind,
                    "text": e.text,
                    "tool_name": e.tool_name,
                    "call_id": e.presentation.get("call_id"),
                    "status": e.presentation.get("status"),
                    "details": e.presentation.get("details"),
                }
                for e in entries
            ],
        },
    )
    return [update(info, combined)]


def dsh(record, ordinal, info, _locator):
    kind = record.get("type", "")
    if kind == "session":
        if record.get("version") != 4:
            raise ValueError("DSH 仅支持只读 v4 记录；请先在原应用完成格式升级")
        info.native_id = record.get("id", "")
        info.cwd = record.get("cwd", "")
        return []
    data = record.get("data", {})
    at = timestamp(record.get("time"))
    if kind == "session/title":
        info.title = str(data.get("title", ""))[:120]
    if kind in {"request/context", "model/selection"}:
        info.model = data.get("model") or info.model
    key = str(record.get("seq", ordinal))
    if kind == "turn/start":
        info.turn_id = native_id(data.get("turnId") or data.get("turn_id"))
    turn_id = native_id(data.get("turnId") or data.get("turn_id")) or info.turn_id
    if kind == "turn/end":
        info.turn_id = None
    reason = data.get("reason")
    if kind == "turn/end" and isinstance(reason, dict) and reason.get("kind") == "error":
        failure = reason.get("error")
        if isinstance(failure, dict):
            code = str(failure.get("code") or "")
            message = text(failure.get("message"))
        else:
            code, message = "", text(failure)
        return [
            update(
                info,
                Entry(
                    key,
                    ordinal,
                    "system",
                    "error",
                    ": ".join(filter(None, [code, message])) or "原端执行失败",
                    at,
                    presentation={"turn_id": turn_id},
                ),
            )
        ]
    if kind == "turn/end":
        return duration_entry(f"duration:{key}", ordinal, at, turn_id, data.get("durationMs"))
    if kind == "tool/call":
        return [
            update(
                info,
                Entry(
                    key,
                    ordinal,
                    "assistant",
                    "tool_call",
                    json.dumps(data.get("arguments", {}), ensure_ascii=False),
                    at,
                    tool_name=data.get("name") or "",
                    presentation={
                        "call_id": native_id(data.get("callId") or data.get("call_id")),
                        "turn_id": turn_id,
                        "details": tool_details(data.get("name"), data.get("arguments")),
                    },
                ),
            )
        ]
    if kind not in {"user/message", "assistant/message", "tool/result", "system/message"}:
        return []
    message = data.get("message", {})
    content = data.get(
        "content", message.get("content", "") if isinstance(message, dict) else message
    )
    role = kind.split("/")[0]
    if role == "tool":
        entries = [
            Entry(
                key,
                ordinal,
                role,
                "tool_result",
                text(content),
                at,
                presentation={
                    "call_id": native_id(data.get("callId") or data.get("call_id")),
                    "turn_id": turn_id,
                    "status": "failed" if data.get("isError") is True else None,
                    **answer_details(data.get("result", content)),
                },
            )
        ]
    else:
        entries = blocks(content, key=key, ordinal=ordinal, role=role, at=at)
    for entry in entries:
        entry.presentation["turn_id"] = turn_id
    return [update(info, entry) for entry in entries]
