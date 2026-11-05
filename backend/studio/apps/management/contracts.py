"""Bounded host commands. There are no caller-selected commands, files or upstreams."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from studio.contracts.gateway.service_status import DeploymentServicesOut, DeploymentServiceState


class ApplicationState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phase: Literal["stopped", "starting", "running", "stopping", "failed", "unavailable"] = (
        "unavailable"
    )
    error: str = Field(default="", max_length=500)
    force_stop_available: bool = False


class EndpointState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    phase: Literal["off", "connecting", "ready", "reconnecting", "failed", "unavailable"] = (
        "unavailable"
    )
    url: str = Field(default="", max_length=2048)
    error: str = Field(default="", max_length=500)
    build_id: str = Field(default="", max_length=100)


class HostState(BaseModel):
    model_config = ConfigDict(extra="forbid")
    application: ApplicationState = Field(default_factory=ApplicationState)
    business: EndpointState = Field(default_factory=EndpointState)
    management: EndpointState = Field(default_factory=EndpointState)
    observed_at: str = ""
    services: list[DeploymentServiceState] = Field(default_factory=list, max_length=100)

    @field_validator("services")
    @classmethod
    def valid_services(cls, value):
        return DeploymentServicesOut(services=value).services


class ManagementApplicationAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    action: Literal["start", "stop", "restart", "force_stop"]


class ManagementAccessAction(BaseModel):
    model_config = ConfigDict(extra="forbid")
    request_id: UUID
    action: Literal["public_start", "public_stop", "check"]


class ManagementJob(BaseModel):
    id: str
    status: str
    operation: str
    result: dict | None = None
    error_code: str = ""
    message: str = ""
    revision: int


class RuntimeContext(BaseModel):
    local_browser: bool


class RuntimeLogs(BaseModel):
    lines: list[str]


HOST_OPERATIONS = frozenset({"management.application", "management.access", "management.logs"})
