"""Account registration and invitation protocol, independent of model policy."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class RegistrationIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=120)
    email: str | None = Field(default=None, max_length=254)
    password: str = Field(min_length=1, max_length=256)
    invite_code: str = Field(min_length=1, max_length=200)


class RegistrationInviteIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    max_uses: int = Field(default=1, ge=1, le=10000)
    validity_days: int = Field(default=7, ge=1, le=365)


class RegistrationInvitePatch(BaseModel):
    expected_revision: int = Field(ge=0)
    enabled: bool | None = None
    max_uses: int | None = Field(default=None, ge=1, le=10000)


class RegistrationInviteAction(BaseModel):
    expected_revision: int = Field(ge=0)
    action: Literal["extend", "reset_expiry", "delete"]
    days: int = Field(default=7, ge=1, le=365)


class RegistrationInviteOut(BaseModel):
    id: str
    name: str
    code_hint: str
    enabled: bool
    status: Literal["active", "disabled", "expired", "exhausted", "deleted"]
    max_uses: int
    used_count: int
    validity_days: int
    expires_at: datetime
    revision: int
    created_at: datetime


class RegistrationInvitePage(BaseModel):
    items: list[RegistrationInviteOut]
    total: int
    page: int
    page_size: int


class SecretOut(BaseModel):
    secret: str


class RegistrationInviteCreated(BaseModel):
    invite: RegistrationInviteOut
    secret: str


class RedemptionOut(BaseModel):
    id: str
    username: str
    display_name: str
    created_at: datetime


class RedemptionPage(BaseModel):
    items: list[RedemptionOut]
    total: int
    page: int
    page_size: int
