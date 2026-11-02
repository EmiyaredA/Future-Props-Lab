"""Strictly read-only native collection; this worker cannot start or control an Agent."""

import base64
from dataclasses import asdict
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, JsonValue

from app.capabilities.agents.sessions.attachments import read_reference
from app.capabilities.agents.sessions.catalog import candidates, get_adapter
from app.capabilities.agents.sessions.locations import validate_location


class CollectionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    agent_id: Literal["codex", "claude-code", "opencode", "dsh", "pi"] | None = None
    root: str = Field(default="", max_length=4096)
    endpoint: str = Field(default="", max_length=255)
    locator: str = Field(default="", max_length=8192)
    checkpoint: dict[str, JsonValue] = Field(default_factory=dict)
    reference: str = Field(default="", max_length=8192)


OPERATIONS = frozenset(
    {
        "agent_sources.candidates",
        "agent_sources.validate",
        "agent_sources.discover",
        "agent_sources.watch",
        "agent_sources.attachment",
    }
)


def execute(operation, payload):
    if operation not in OPERATIONS:
        raise ValueError("此 worker 不允许执行该操作")
    if operation == "agent_sources.candidates":
        if payload:
            raise ValueError("候选来源操作不接受额外参数")
        return {"candidates": candidates()}
    command = CollectionRequest.model_validate(payload)
    if operation != "agent_sources.attachment" and command.agent_id is None:
        raise ValueError("缺少原生来源类型")
    root, endpoint = validate_location(
        agent_id=command.agent_id, root=command.root, endpoint=command.endpoint
    )
    if operation == "agent_sources.validate":
        return {"root": root, "endpoint": endpoint}
    if operation == "agent_sources.attachment":
        if endpoint or not command.reference:
            raise ValueError("原生附件必须属于已绑定的真实目录")
        data, filename = read_reference(root, command.reference)
        return {"content_base64": base64.b64encode(data).decode(), "filename": filename}
    adapter = get_adapter(command.agent_id, endpoint)
    if operation == "agent_sources.discover":
        return {"locators": adapter.discover(root)}
    if not command.locator:
        raise ValueError("缺少原生记录定位符")
    return {"batch": asdict(adapter.watch(root, command.locator, command.checkpoint))}
