"""Path-free, versioned Creative/Integrations capability values."""

import re
from dataclasses import dataclass
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from studio.contracts.integrations.integration_intents import digest

PREFIX = "/_internal/v1/creative-integrations"
CreativeSourceKind = Literal["tool_api", "mcp", "skill"]


class CreativeArchiveDescriptor(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0)
    version: str = Field(pattern=r"^v[1-9][0-9]*$")
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    byte_size: int = Field(gt=0)
    file_count: int = Field(gt=0)
    expanded_bytes: int = Field(ge=0)


class CreativeSourceSnapshot(BaseModel):
    model_config = ConfigDict(extra="forbid")
    kind: CreativeSourceKind
    title: str = Field(min_length=1, max_length=120)
    summary: str = Field(max_length=4000)
    manifest: dict
    skill: CreativeArchiveDescriptor | None = None

    @model_validator(mode="after")
    def archive_belongs_to_skill(self):
        if self.skill is not None and self.kind != "skill":
            raise ValueError("只有 Skill 来源可包含归档")
        return self


@dataclass(frozen=True)
class CreativeSourceTarget:
    kind: CreativeSourceKind
    source_id: str
    revision: int | None = None
    sha256: str | None = None


def creative_source_target(method, path):
    if method != "GET":
        return None
    identity = r"[A-Za-z0-9_-]{1,100}"
    base = re.escape(PREFIX)
    descriptor = re.fullmatch(base + r"/sources/(tool_api|mcp|skill)/(" + identity + r")", path)
    if descriptor:
        return CreativeSourceTarget(kind=descriptor[1], source_id=descriptor[2])
    content = re.fullmatch(
        base + r"/sources/skill/(" + identity + r")/content/([0-9]+)/([a-f0-9]{64})", path
    )
    if content:
        return CreativeSourceTarget(
            kind="skill", source_id=content[1], revision=int(content[2]), sha256=content[3]
        )
    return None


class CreativeSkillBlob(BaseModel):
    model_config = ConfigDict(extra="forbid")
    tree_sha256: str | None = Field(
        default=None, pattern=r"^[a-f0-9]{64}$", exclude_if=lambda value: value is None
    )
    sha256: str = Field(pattern=r"^[a-f0-9]{64}$")
    byte_size: int = Field(gt=0)
    file_count: int = Field(gt=0)
    expanded_bytes: int = Field(ge=0)


class CreativeInstallPart(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    kind: CreativeSourceKind
    title: str = Field(min_length=1, max_length=120)
    target_name: str = Field(min_length=1, max_length=120)
    summary: str = Field(max_length=500)
    tags: list[str] = Field(default_factory=list, max_length=30)
    manifest: dict
    skill: CreativeSkillBlob | None = None

    @model_validator(mode="after")
    def valid_part(self):
        if self.target_name != self.target_name.strip() or not self.target_name:
            raise ValueError("安装名称必须去除首尾空格")
        if (self.kind == "skill") != (self.skill is not None):
            raise ValueError("Skill 批次必须包含准确的归档描述")
        return self


def part_fingerprint(part: CreativeInstallPart):
    return digest(part.model_dump(mode="json", exclude={"target_name"}))


class CreativeInstallBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation_id: str = Field(
        pattern=r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
    )
    root_release_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    parts: list[CreativeInstallPart] = Field(min_length=1, max_length=50)

    @model_validator(mode="after")
    def unique_parts(self):
        if len({part.release_id for part in self.parts}) != len(self.parts):
            raise ValueError("安装批次不能重复相同能力版本")
        return self


class CreativeStdioConfiguration(BaseModel):
    model_config = ConfigDict(extra="forbid")
    release_id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,100}$")
    command: str = Field(min_length=1, max_length=1024)
    arguments: list[str] = Field(default_factory=list, max_length=64)
    environment: dict[str, str] = Field(default_factory=dict, max_length=100, repr=False)


@dataclass(frozen=True)
class CreativeOperationGrant:
    """A short-lived Identity decision for one actor, action and exact input digest."""

    owner_user_id: str
    purpose: Literal["install", "receipt", "cancel", "setup", "preview"]
    operation_id: str
    fingerprint: str
    expires_at: int
