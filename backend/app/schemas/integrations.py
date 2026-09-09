from __future__ import annotations

import re
from typing import Any, Literal

from jsonschema import Draft202012Validator, SchemaError
from pydantic import BaseModel, Field, field_validator, model_validator

from app.core.outbound_urls import normalize_integration_http_url

IntegrationStatus = Literal["unchecked", "healthy", "failed"]
IntegrationKind = Literal["tool_api", "mcp"]
HEADER_NAME = re.compile(r"^[!#$%&'*+.^_`|~0-9A-Za-z-]+$")
ENVIRONMENT_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
FORBIDDEN_API_KEY_HEADERS = {"connection", "content-length", "host", "transfer-encoding"}


def _clean_tags(values: list[str]) -> list[str]:
    result: list[str] = []
    for value in values:
        item = value.strip()
        if item and item not in result:
            result.append(item)
    return result[:12]


class IntegrationCheckOut(BaseModel):
    id: str
    resource_kind: IntegrationKind
    resource_id: str
    resource_name: str
    ok: bool
    status_code: int | None
    latency_ms: int
    summary: str
    created_at: str


class IntegrationOverviewOut(BaseModel):
    primary_count: int
    failed_count: int
    tertiary_count: int
    recent: list[IntegrationCheckOut] = Field(default_factory=list)


class ToolApiBaseIn(BaseModel):
    sensitive_result: bool = False
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    method: Literal["GET", "POST", "PUT", "PATCH", "DELETE"] = "GET"
    url: str = Field(min_length=1, max_length=1024)
    auth_kind: Literal["none", "bearer", "api_key"] = "none"
    auth_header_name: str = Field(default="", max_length=120)
    secret: str = Field(default="", max_length=8192)
    clear_secret: bool = False
    parameters_schema: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    query_template: dict[str, Any] = Field(default_factory=dict)
    body_template: Any | None = None
    tags: list[str] = Field(default_factory=list, max_length=12)
    enabled: bool = True

    @field_validator("name", "description", "auth_header_name")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("url")
    @classmethod
    def safe_url(cls, value: str) -> str:
        return normalize_integration_http_url(value)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return _clean_tags(value)

    @field_validator("parameters_schema")
    @classmethod
    def valid_json_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        try:
            Draft202012Validator.check_schema(value)
        except SchemaError as exc:
            raise ValueError(f"输入 JSON Schema 无效：{exc.message}") from exc
        return value

    @model_validator(mode="after")
    def valid_auth(self) -> ToolApiBaseIn:
        if self.auth_kind == "api_key" and not self.auth_header_name:
            raise ValueError("API-Key 认证必须提供 Header 名称")
        if self.auth_kind == "api_key" and (
            not HEADER_NAME.fullmatch(self.auth_header_name)
            or self.auth_header_name.lower() in FORBIDDEN_API_KEY_HEADERS
        ):
            raise ValueError("API-Key Header 名称无效或不允许覆盖该请求头")
        if self.auth_kind == "none":
            self.secret = ""
            self.clear_secret = True
        if self.auth_kind != "api_key":
            self.auth_header_name = ""
        if self.parameters_schema.get("type") != "object":
            raise ValueError("输入 Schema 的根类型必须是 object")
        return self


class ToolApiCreateIn(ToolApiBaseIn):
    pass


class ToolApiUpdateIn(ToolApiBaseIn):
    expected_revision: int = Field(ge=0)


class ToolApiOut(BaseModel):
    sensitive_result: bool = False
    id: str
    name: str
    description: str
    method: str
    url: str
    auth_kind: str
    auth_header_name: str
    has_secret: bool
    secret_hint: str
    parameters_schema: dict[str, Any]
    query_template: dict[str, Any]
    body_template: Any | None
    tags: list[str]
    enabled: bool
    status: IntegrationStatus
    status_message: str
    last_checked_at: str | None
    revision: int
    created_at: str
    updated_at: str


class ToolApiCatalogOut(BaseModel):
    items: list[ToolApiOut]
    overview: IntegrationOverviewOut


class ToolApiValidateIn(BaseModel):
    input: dict[str, Any] = Field(default_factory=dict)


class ToolApiValidationOut(BaseModel):
    check: IntegrationCheckOut
    response_preview: str
    content_type: str


class McpBaseIn(BaseModel):
    sensitive_result: bool = False
    name: str = Field(min_length=1, max_length=120)
    description: str = Field(default="", max_length=500)
    transport: Literal["streamable_http", "stdio"] = "streamable_http"
    url: str = Field(default="", max_length=1024)
    command: str = Field(default="", max_length=1024)
    arguments: list[str] = Field(default_factory=list, max_length=64)
    bearer_token: str = Field(default="", max_length=8192)
    clear_bearer_token: bool = False
    environment: dict[str, str] = Field(default_factory=dict)
    clear_environment: bool = False
    tags: list[str] = Field(default_factory=list, max_length=12)
    enabled: bool = True

    @field_validator("name", "description", "url", "command")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return _clean_tags(value)

    @model_validator(mode="after")
    def valid_transport(self) -> McpBaseIn:
        if self.transport == "streamable_http":
            if not self.url:
                raise ValueError("Streamable HTTP 必须提供 URL")
            self.url = normalize_integration_http_url(self.url)
            self.command = ""
            self.arguments = []
            self.environment = {}
            self.clear_environment = True
        else:
            if not self.command:
                raise ValueError("stdio 必须提供命令")
            self.url = ""
            self.bearer_token = ""
            self.clear_bearer_token = True
        for argument in self.arguments:
            if len(argument) > 4096 or "\x00" in argument:
                raise ValueError("stdio 参数无效或过长")
        for key, value in self.environment.items():
            if len(key) > 120 or not ENVIRONMENT_NAME.fullmatch(key):
                raise ValueError("环境变量名称无效")
            if len(value) > 8192 or "\x00" in value:
                raise ValueError("环境变量值无效或过长")
        return self


class McpCreateIn(McpBaseIn):
    pass


class McpUpdateIn(McpBaseIn):
    expected_revision: int = Field(ge=0)


class McpOut(BaseModel):
    sensitive_result: bool = False
    id: str
    name: str
    description: str
    transport: str
    url: str
    command: str
    arguments: list[str]
    has_bearer_token: bool
    bearer_hint: str
    environment_keys: list[str]
    tags: list[str]
    enabled: bool
    status: IntegrationStatus
    status_message: str
    server_name: str
    server_version: str
    protocol_version: str
    tool_count: int
    last_checked_at: str | None
    revision: int
    created_at: str
    updated_at: str


class McpToolOut(BaseModel):
    id: str
    name: str
    description: str
    input_schema: dict[str, Any]


class McpCatalogOut(BaseModel):
    items: list[McpOut]
    overview: IntegrationOverviewOut


class McpValidationOut(BaseModel):
    check: IntegrationCheckOut
    server: McpOut
    tools: list[McpToolOut]


class SkillOut(BaseModel):
    id: str
    name: str
    description: str
    default_version: str
    latest_version: str
    version_count: int
    tags: list[str]
    enabled: bool
    status: IntegrationStatus
    status_message: str
    revision: int
    created_at: str
    updated_at: str


class SkillVersionOut(BaseModel):
    id: str
    version: str
    name: str
    description: str
    content_sha256: str
    file_count: int
    expanded_bytes: int
    created_at: str


class SkillCatalogOut(BaseModel):
    items: list[SkillOut]
    enabled_count: int
    draft_count: int
    version_count: int


class SkillTagsIn(BaseModel):
    tags: list[str] = Field(default_factory=list, max_length=12)

    @field_validator("tags")
    @classmethod
    def clean_tags(cls, value: list[str]) -> list[str]:
        return _clean_tags(value)


class SkillUpdateIn(SkillTagsIn):
    expected_revision: int = Field(ge=0)
    enabled: bool
    default_version: str = Field(min_length=2, max_length=24, pattern=r"^v[1-9][0-9]*$")


class DeleteOut(BaseModel):
    deleted: bool = True
