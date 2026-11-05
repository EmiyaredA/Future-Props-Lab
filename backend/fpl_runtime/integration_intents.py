"""Accepted integration work is bound to exact resources and input, not a reusable actor token."""

import hashlib
import json
import re
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .claims import Actor


def digest(value):
    return hashlib.sha256(
        json.dumps(
            value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False
        ).encode()
    ).hexdigest()


class IntegrationScope(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: Literal[
        "tool.validate", "mcp.validate", "tool.call", "mcp.call", "external.sync", "demo.install"
    ]
    task_id: UUID
    source_resource_id: str = Field(default="", max_length=100)
    connection_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    connection_revision: int = Field(ge=0)
    input_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    document_id: str = Field(default="", max_length=200, pattern=r"^[A-Za-z0-9]*$")
    tool_name: str = Field(default="", max_length=160)

    @model_validator(mode="after")
    def bounded_scope(self):
        if self.kind == "external.sync":
            if not self.source_resource_id or not self.document_id or self.tool_name:
                raise ValueError("外部同步缺少固定文章或文档范围")
        elif self.document_id:
            raise ValueError("工具任务不能选择外部文章文档")
        if self.kind == "mcp.call" and not self.tool_name:
            raise ValueError("MCP调用缺少工具名")
        if self.kind != "mcp.call" and self.tool_name:
            raise ValueError("此操作不能选择MCP工具")
        return self


class IntegrationIntentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: Literal["integrations", "thought", "amadeus", "models"]
    request_id: UUID
    source_method: Literal["POST"]
    source_path: str = Field(min_length=1, max_length=4096)
    assertion: str = Field(min_length=1, max_length=8192)
    scope: IntegrationScope

    def matches(self, catalog):
        source = catalog.match(self.source_method, self.source_path)
        if source is None or source.service != self.caller:
            return False
        scope = self.scope
        if self.caller == "integrations" and scope.kind in {"mcp.validate", "tool.validate"}:
            resource = "mcp" if scope.kind == "mcp.validate" else "tool-apis"
            return self.source_path == f"/v1/integrations/{resource}/{scope.connection_id}/validate"
        if self.caller == "models" and scope.kind == "demo.install":
            return (
                self.source_path == "/v1/account/demo-services/example_tools/install"
                and scope.connection_id == "example_tools"
            )
        if self.caller == "thought" and scope.kind == "external.sync":
            return (
                self.source_path
                == f"/v1/thought-workshop/notes/{scope.source_resource_id}/external-sync/tasks"
            )
        if self.caller == "amadeus" and scope.kind in {"mcp.call", "tool.call"}:
            match = re.fullmatch(
                r"/v1/amadeus/conversations/([^/]{1,100})/actions/([^/]{1,100})/execute(?:/stream)?",
                self.source_path,
            )
            return bool(
                match and match[1] == scope.source_resource_id and match[2] == str(scope.task_id)
            )
        return False


class IntegrationIntentReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    scope: IntegrationScope


class IntegrationIntentCheck(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["integrations", "models", "thought", "amadeus"]
    intent_id: UUID


class IntegrationDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    allowed: bool
    expires_at: int
    scope: IntegrationScope
    actor: Actor


class IntegrationCapacityGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["integrations"] = "integrations"
    intent_id: UUID
    operation: Literal["acquire", "release", "demo"]

    @property
    def path(self):
        return f"/_internal/v1/integration-capacity/{self.intent_id}/{self.operation}"


class IntegrationGrantReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assertion: str = Field(min_length=1, max_length=8192)


class DemoInstallGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service: Literal["models"] = "models"
    intent_id: UUID
    operation: Literal["install", "receipt"]

    @property
    def path(self):
        return f"/_internal/v1/demo-tool-installations/{self.intent_id}"

    @property
    def method(self):
        return "POST" if self.operation == "install" else "GET"


TOOL_CALL_PATH = "/_internal/v1/amadeus-tool-calls"
TOOL_CALL_MAX_BYTES = 8 * 1024 * 1024


class AmadeusToolGrant(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent_id: UUID

    @property
    def path(self):
        return f"{TOOL_CALL_PATH}/{self.intent_id}"


class AmadeusToolOutcome(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["completed", "failed", "unknown"]
    result: dict
