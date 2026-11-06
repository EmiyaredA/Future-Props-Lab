from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class LoginIn(BaseModel):
    username: str
    password: str


class ReauthIn(BaseModel):
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class CurrentUserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    avatar_url: str | None
    is_platform_admin: bool
    platform_role: Literal["admin", "user"] = "user"
    revision: int


class AuthMeOut(BaseModel):
    storage_upgrade_required: bool = False
    user: CurrentUserOut
    permission_keys: list[str] = Field(default_factory=list)
    must_change_password: bool
    session_expires_at: datetime | None


class AccountProfilePatchIn(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, max_length=254)
    expected_revision: int = Field(ge=0)


class AccountAvatarDeleteIn(BaseModel):
    expected_revision: int = Field(ge=0)


class AccountSessionOut(BaseModel):
    id: str
    created_at: datetime
    last_seen_at: datetime
    idle_expires_at: datetime
    absolute_expires_at: datetime
    client_ip: str
    user_agent: str
    is_current: bool


class AccountSessionListOut(BaseModel):
    items: list[AccountSessionOut]
    total: int


class AccountOut(BaseModel):
    email: str | None = None
    id: str
    username: str
    display_name: str
    status: Literal["active", "disabled"]
    is_platform_admin: bool
    platform_role: Literal["admin", "user"] = "user"
    must_change_password: bool
    revision: int
    last_login_at: datetime | None
    created_at: datetime


class AccountListOut(BaseModel):
    page: int = 1
    page_size: int = 25
    items: list[AccountOut]
    total: int


class AccountCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str = Field(default="", max_length=120)
    email: str | None = Field(default=None, max_length=254)
    is_platform_admin: bool = False
    platform_role: Literal["admin", "user"] | None = None


class AccountCreatedOut(BaseModel):
    account: AccountOut
    temporary_password: str


class AccountPatchIn(BaseModel):
    status: Literal["active", "disabled"] | None = None
    is_platform_admin: bool | None = None
    platform_role: Literal["admin", "user"] | None = None
    expected_revision: int = Field(ge=0)

    @model_validator(mode="after")
    def require_change(self):
        if self.status is None and self.is_platform_admin is None and self.platform_role is None:
            raise ValueError("请选择要修改的状态或平台身份")
        if self.platform_role is not None and self.is_platform_admin is not None:
            raise ValueError("不能同时提交新旧平台身份字段")
        return self


class AccountResetPasswordIn(BaseModel):
    expected_revision: int = Field(ge=0)


class ResetPasswordOut(BaseModel):
    account: AccountOut
    temporary_password: str


class ApiKeyCreateIn(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    scopes: list[Literal["studio:read", "studio:write"]]
    expires_in_days: int = Field(default=90, ge=1, le=365)


class ApiKeyOut(BaseModel):
    id: str
    name: str
    key_prefix: str
    secret_available: bool
    scopes: list[str]
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revision: int
    created_at: datetime


class ApiKeyCreatedOut(BaseModel):
    api_key: ApiKeyOut
    secret: str = Field(repr=False)


class ApiKeySecretOut(BaseModel):
    secret: str = Field(repr=False)


class RevokeApiKeyIn(BaseModel):
    expected_revision: int = Field(ge=0)


class RenewApiKeyIn(BaseModel):
    expected_revision: int = Field(ge=0)
    expires_in_days: int = Field(default=90, ge=1, le=365)


class DeleteApiKeyIn(BaseModel):
    expected_revision: int = Field(ge=0)


class SecurityAuditEventOut(BaseModel):
    id: str
    event_type: str
    outcome: str
    actor_username: str | None
    target_username: str | None
    owner_user_id: str | None
    client_ip: str
    user_agent: str
    metadata: dict
    created_at: datetime


class SecurityAuditListOut(BaseModel):
    items: list[SecurityAuditEventOut]
    total: int
    page: int
    page_size: int


class AccountDirectoryItem(BaseModel):
    user_id: str
    username: str
    display_name: str


class AccountDirectoryOut(BaseModel):
    items: list[AccountDirectoryItem]
