"""Request-bound public account directory protocol; no credentials or private profile data."""

import hashlib
import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

PREFIX = "/_internal/v1/thought-account-directory/"


class AccountProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str = Field(min_length=1, max_length=100)
    username: str = Field(max_length=64)
    display_name: str = Field(max_length=120)
    active: bool


class CallerProfile(AccountProfile):
    platform_role: Literal["admin", "user"]
    revision: int = Field(ge=0)


class DirectoryQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ids: list[str] = Field(default_factory=list, max_length=2000)
    usernames: list[str] = Field(default_factory=list, max_length=2000)

    @field_validator("ids")
    @classmethod
    def identifiers(cls, values):
        if any(not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value) for value in values):
            raise ValueError("账号ID无效")
        return sorted(set(values))

    @field_validator("usernames")
    @classmethod
    def normalized_names(cls, values):
        if any(not re.fullmatch(r"[A-Za-z0-9._-]{3,64}", value.strip()) for value in values):
            raise ValueError("用户名无效")
        return sorted({value.strip().lower() for value in values})

    @property
    def digest(self):
        return hashlib.sha256(
            json.dumps(self.model_dump(), sort_keys=True, separators=(",", ":")).encode()
        ).hexdigest()

    @property
    def path(self):
        return PREFIX + self.digest


class DirectoryResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    caller: CallerProfile
    profiles: list[AccountProfile] = Field(max_length=4000)


def directory_path(method, path):
    return method == "POST" and re.fullmatch(re.escape(PREFIX) + r"[a-f0-9]{64}", path) is not None


def directory_grant(grant, catalog):
    original = catalog.match(grant.source_method, grant.source_path)
    return bool(
        grant.caller == "thought"
        and grant.purpose == "thought.accounts.read"
        and original is not None
        and original.service == "thought"
        and grant.target_service == "identity"
        and directory_path(grant.target_method, grant.target_path)
    )
