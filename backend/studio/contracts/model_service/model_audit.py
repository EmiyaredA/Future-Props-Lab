"""Only fixed Models governance outcomes may be delivered into Identity's audit log."""

import hashlib
import json
import re
from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator


class AuditSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    method: Literal["POST", "PUT", "PATCH"]
    path: str = Field(min_length=1, max_length=4096)
    assertion: str = Field(min_length=1, max_length=8192)


SOURCES = {
    "platform.runtime_quotas.updated": ("PATCH", r"/v1/platform/runtime-quotas"),
    "platform.model_template.updated": (
        "PUT",
        r"/v1/platform/model-service-templates/(?P<role>admin|user)",
    ),
    "platform.model_template.previewed": (
        "POST",
        r"/v1/platform/model-service-templates/(?P<role>admin|user)/preview",
    ),
    "platform.model_template.sync_started": (
        "POST",
        r"/v1/platform/model-service-templates/sync-jobs/[^/]{1,100}/start",
    ),
    "platform.model_template.sync_item": (
        "POST",
        r"/v1/platform/model-service-templates/sync-jobs/[^/]{1,100}/start",
    ),
    "demo_service.configured": (
        "PUT",
        r"/v1/platform/demo-services/(?P<demo>mock_model|example_tools)",
    ),
    "demo_service.action": (
        "POST",
        r"/v1/platform/demo-services/(?P<demo>mock_model|example_tools)/actions",
    ),
    "demo_service.installed": (
        "POST",
        r"/v1/account/demo-services/(?:mock_model|example_tools)/install",
    ),
}


class ModelAuditRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    event_type: Literal[
        "platform.runtime_quotas.updated",
        "platform.model_template.updated",
        "platform.model_template.previewed",
        "platform.model_template.sync_started",
        "platform.model_template.sync_item",
        "demo_service.configured",
        "demo_service.action",
        "demo_service.installed",
    ]
    created_at: datetime
    source: AuditSource
    detail: dict[str, str | int] = Field(max_length=5)

    @model_validator(mode="after")
    def fixed_source(self):
        method, pattern = SOURCES[self.event_type]
        match = re.fullmatch(pattern, self.source.path)
        if self.source.method != method or match is None:
            raise ValueError("审计事件不属于此来源操作")
        if set(self.detail) - {"role_to", "revision", "service_id", "action", "status_to"}:
            raise ValueError("审计元数据包含未允许的字段")
        for key, value in self.detail.items():
            if key == "revision":
                if type(value) is not int or value < 0:
                    raise ValueError("审计revision无效")
            elif not isinstance(value, str) or len(value) > 100:
                raise ValueError("审计状态无效")
        groups = match.groupdict()
        if groups.get("role") and self.detail.get("role_to") != groups["role"]:
            raise ValueError("审计角色与来源不符")
        if groups.get("demo") and self.detail.get("service_id") != groups["demo"]:
            raise ValueError("审计演示服务与来源不符")
        return self

    def fingerprint(self):
        value = self.model_dump(mode="json")
        return hashlib.sha256(
            json.dumps(
                value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False
            ).encode()
        ).hexdigest()


class ModelAuditReceipt(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")
    audit_event_id: UUID


class PreparedModelAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    fingerprint: str = Field(pattern=r"^[a-f0-9]{64}$")


class ChildModelAudit(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: UUID
    parent_id: UUID
    created_at: datetime
    status: Literal["succeeded", "skipped", "failed", "completed"]

    def fingerprint(self):
        return hashlib.sha256(
            json.dumps(
                self.model_dump(mode="json"),
                sort_keys=True,
                separators=(",", ":"),
                ensure_ascii=False,
            ).encode()
        ).hexdigest()
