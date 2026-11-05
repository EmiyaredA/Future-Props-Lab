"""Sanitized deployment observations and browser-facing service availability."""

from datetime import UTC, datetime
from enum import StrEnum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.gateway.catalog import SERVICES

ServiceId = StrEnum("ServiceId", {s.id.replace("-", "_"): s.id for s in SERVICES})


class ServicePhase(StrEnum):
    RUNNING = "running"
    STARTING = "starting"
    STOPPED = "stopped"
    PAUSED = "paused"
    RESTARTING = "restarting"
    UNHEALTHY = "unhealthy"
    FAILED = "failed"
    UNREACHABLE = "unreachable"
    NOT_DEPLOYED = "not_deployed"
    UNKNOWN = "unknown"
    DEGRADED = "degraded"


class DeploymentServiceState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    service_id: ServiceId
    phase: ServicePhase
    reason: str = Field(default="", max_length=64, pattern=r"^[a-z_]*$")
    exit_code: int | None = Field(default=None, ge=0, le=255)


class DeploymentServicesOut(BaseModel):
    model_config = ConfigDict(extra="forbid")
    observed_at: datetime | None = None
    services: list[DeploymentServiceState] = Field(default_factory=list, max_length=len(SERVICES))

    @model_validator(mode="after")
    def unique_services(self):
        if len({s.service_id for s in self.services}) != len(self.services):
            raise ValueError("部署状态包含重复服务")
        if self.observed_at is not None and self.observed_at.tzinfo is None:
            self.observed_at = self.observed_at.replace(tzinfo=UTC)
        return self


class ServiceIssue(BaseModel):
    service_id: ServiceId
    label: str
    phase: ServicePhase


class ServiceStatusOut(BaseModel):
    service_id: ServiceId
    phase: ServicePhase
    label: str
    detail: str
    checked_at: datetime
    dependencies: list[ServiceIssue] = Field(default_factory=list)


class ServicesStatusOut(BaseModel):
    mode: Literal["monolith", "independent"]
    checked_at: datetime
    services: list[ServiceStatusOut]


def status_time():
    return datetime.now(UTC)


def monolith_status(now):
    return ServicesStatusOut(
        mode="monolith",
        checked_at=now,
        services=[
            ServiceStatusOut(
                service_id=service.id,
                label=service.label,
                phase=ServicePhase.UNKNOWN
                if service.id in {"management", "remote"}
                else ServicePhase.RUNNING,
                detail="独立服务状态暂不可读"
                if service.id in {"management", "remote"}
                else "当前网站进程正常响应；该功能仍由单体网站承载",
                checked_at=now,
            )
            for service in SERVICES
        ],
    )
