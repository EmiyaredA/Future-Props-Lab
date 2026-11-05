"""Narrow Agent Runtime native commands and authenticated host settings."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.capabilities.agents.cli.definitions import DEFINITIONS, AgentId

CATALOG = "code_agents.catalog"
DETECT = "code_agents.detect"
ENABLE = "code_agents.enable"
ACCEPTANCE = "code_agents.visual_acceptance"
READ_OPERATIONS = frozenset((CATALOG, DETECT, ACCEPTANCE))
OPERATIONS = READ_OPERATIONS | {ENABLE}
PREFIX = "/v1/code-agents"


class CatalogRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    show_paths: bool = False


class AcceptanceProbe(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    probe: bool


class AcceptanceAgentStatus(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: AgentId
    available: bool
    message: str = Field(max_length=300)
    signature: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")


class AcceptanceAgentCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[AcceptanceAgentStatus] = Field(
        min_length=len(DEFINITIONS), max_length=len(DEFINITIONS)
    )

    @model_validator(mode="after")
    def fixed_connections(self):
        if tuple(item.id for item in self.items) != tuple(DEFINITIONS):
            raise ValueError("Agent 验收回执与固定连接范围不符")
        return self


class EnableRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    agent_id: AgentId


class EnableResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    enabled: Literal[True]


class ConnectionOptions(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    identity_credential: str
    ingress: str
    workers: dict[str, str]

    @field_validator("identity_credential", "ingress")
    @classmethod
    def credential(cls, value):
        if not re.fullmatch(r"[A-Za-z0-9_-]{32,256}", value):
            raise ValueError("Agent Runtime 原生凭据格式无效")
        return value

    @model_validator(mode="after")
    def separate_credentials(self):
        if not self.workers or any(
            not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", worker) for worker in self.workers
        ):
            raise ValueError("Agent Runtime 必须登记原生执行器")
        values = [
            self.identity_credential,
            self.ingress,
            *map(self.credential, self.workers.values()),
        ]
        if len(set(values)) != len(values):
            raise ValueError("Agent Runtime 原生凭据必须分开生成")
        return self
