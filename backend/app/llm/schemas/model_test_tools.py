from __future__ import annotations

import json
import re
from typing import Any, Literal

from jsonschema import Draft202012Validator, SchemaError
from pydantic import BaseModel, Field, field_validator, model_validator

TOOL_NAME = re.compile(r"^[A-Za-z0-9_]{1,64}$")
JSON_LIMIT = 64 * 1024


def _json_size(value: Any, label: str) -> Any:
    try:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{label}必须是有效 JSON") from exc
    if len(encoded) > JSON_LIMIT:
        raise ValueError(f"{label}不能超过 64 KiB")
    return value


def _schema(value: dict[str, Any]) -> dict[str, Any]:
    _json_size(value, "输入 Schema")
    try:
        Draft202012Validator.check_schema(value)
    except SchemaError as exc:
        raise ValueError(f"输入 JSON Schema 无效：{exc.message}") from exc
    if value.get("type") != "object":
        raise ValueError("输入 Schema 的根类型必须是 object")
    return value


class ModelTestToolBaseIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    description: str = Field(default="", max_length=1000)
    input_schema: dict[str, Any] = Field(
        default_factory=lambda: {"type": "object", "properties": {}}
    )
    mock_kind: Literal["success", "failure"] = "success"
    mock_result: Any = Field(default_factory=dict)
    error_code: str = Field(default="mock_failure", max_length=120)
    error_message: str = Field(default="模拟工具执行失败", max_length=1000)
    delay_ms: int = Field(default=0, ge=0, le=10000)
    enabled: bool = True

    @field_validator("name")
    @classmethod
    def valid_name(cls, value: str) -> str:
        value = value.strip()
        if not TOOL_NAME.fullmatch(value):
            raise ValueError("工具名称只能包含字母、数字和下划线")
        return value

    @field_validator("description", "error_code", "error_message")
    @classmethod
    def clean_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("input_schema")
    @classmethod
    def valid_schema(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _schema(value)

    @field_validator("mock_result")
    @classmethod
    def valid_result(cls, value: Any) -> Any:
        return _json_size(value, "模拟返回")

    @model_validator(mode="after")
    def valid_failure(self) -> ModelTestToolBaseIn:
        if self.mock_kind == "failure" and (not self.error_code or not self.error_message):
            raise ValueError("模拟失败必须提供错误码和错误说明")
        return self


class ModelTestToolCreateIn(ModelTestToolBaseIn):
    pass


class ModelTestToolPatchIn(ModelTestToolBaseIn):
    expected_revision: int = Field(ge=0)


class ModelTestToolSummaryOut(BaseModel):
    id: str
    name: str
    description: str
    parameter_count: int
    mock_kind: Literal["success", "failure"]
    delay_ms: int
    enabled: bool
    revision: int
    last_used_at: str | None
    created_at: str
    updated_at: str


class ModelTestToolCallOut(BaseModel):
    id: str
    source: Literal["dry_run", "model_test", "realtime_voice"]
    conversation_id: str | None
    message_id: str | None
    run_id: str
    round_index: int
    tool_id: str | None
    tool_name: str
    tool_revision: int
    arguments: dict[str, Any]
    status: Literal["proposed", "running", "completed", "failed", "cancelled"]
    success: bool | None
    result: Any | None
    error_code: str
    error_message: str
    configured_delay_ms: int
    duration_ms: int
    created_at: str
    updated_at: str


class ModelTestToolOut(ModelTestToolSummaryOut):
    input_schema: dict[str, Any]
    mock_result: Any
    error_code: str
    error_message: str
    bound_conversation_count: int = 0
    recent_calls: list[ModelTestToolCallOut] = Field(default_factory=list)


class ModelTestToolOverviewOut(BaseModel):
    total: int
    enabled: int
    failure: int
    today_runs: int
    recent: list[ModelTestToolSummaryOut] = Field(default_factory=list)


class ModelTestToolCatalogOut(BaseModel):
    items: list[ModelTestToolSummaryOut]
    overview: ModelTestToolOverviewOut


class ModelTestToolExecuteIn(BaseModel):
    expected_revision: int = Field(ge=0)
    input: dict[str, Any] = Field(default_factory=dict)

    @field_validator("input")
    @classmethod
    def valid_input_size(cls, value: dict[str, Any]) -> dict[str, Any]:
        return _json_size(value, "输入参数")
