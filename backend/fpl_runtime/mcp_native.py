"""Path-free MCP leases; registered host launch profiles are fetched only in memory."""

from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

OPERATIONS = frozenset({"integrations.mcp-discover", "integrations.mcp-call"})


class McpNativePayload(BaseModel):
    model_config = ConfigDict(extra="forbid")
    intent_id: UUID
    connection_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    connection_revision: int = Field(ge=0)
    input_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    launch_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    sensitive_result: bool
    tool_name: str = Field(default="", max_length=160)


class McpHostObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profiles: list[str] = Field(max_length=100)

    @model_validator(mode="after")
    def unique_profiles(self):
        import re

        if len(self.profiles) != len(set(self.profiles)) or any(
            not re.fullmatch(r"[a-f0-9]{64}", value) for value in self.profiles
        ):
            raise ValueError("MCP host profile digest invalid")
        return self


class McpLaunch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    command: str = Field(min_length=1, max_length=1024)
    arguments: list[str] = Field(max_length=100)
    environment: dict[str, str] = Field(repr=False, max_length=100)
    tool_name: str = Field(default="", max_length=160)
    tool_arguments: dict = Field(default_factory=dict, repr=False)
    sensitive_result: bool
    launch_sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    operation: Literal["integrations.mcp-discover", "integrations.mcp-call"]
