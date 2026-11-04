"""Narrow Agent Runtime native commands and authenticated host settings."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator, model_validator

from app.capabilities.agents.cli.definitions import AgentId

CATALOG = "code_agents.catalog"
DETECT = "code_agents.detect"
ENABLE = "code_agents.enable"
OPERATIONS = frozenset((CATALOG, DETECT, ENABLE))
READ_OPERATIONS = frozenset((CATALOG, DETECT))
PREFIX = "/v1/code-agents"


class CatalogRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    show_paths: bool = False


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
