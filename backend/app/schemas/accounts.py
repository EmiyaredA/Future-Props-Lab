from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator


class LoginIn(BaseModel):
    username: str
    password: str


class ReauthIn(BaseModel):
    password: str


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str


class WorkspaceOut(BaseModel):
    id: str
    name: str
    visibility: Literal["private", "public"]
    revision: int
    access_kind: Literal["owner", "member", "platform_admin", "public_viewer"]
    role: Literal["owner", "member"] | None


class CurrentUserOut(BaseModel):
    id: str
    username: str
    display_name: str
    email: str | None
    avatar_url: str | None
    is_platform_admin: bool
    revision: int


class AuthMeOut(BaseModel):
    user: CurrentUserOut
    workspace: WorkspaceOut
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
    id: str
    username: str
    display_name: str
    status: Literal["active", "disabled"]
    is_platform_admin: bool
    must_change_password: bool
    revision: int
    last_login_at: datetime | None
    created_at: datetime


class AccountListOut(BaseModel):
    items: list[AccountOut]
    total: int


class AccountCreateIn(BaseModel):
    username: str
    display_name: str = ""


class AccountCreatedOut(BaseModel):
    account: AccountOut
    temporary_password: str


class AccountPatchIn(BaseModel):
    status: Literal["active", "disabled"]
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
    scopes: list[str]
    expires_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None
    revision: int
    created_at: datetime


class ApiKeyCreatedOut(BaseModel):
    api_key: ApiKeyOut
    secret: str


class RevokeApiKeyIn(BaseModel):
    expected_revision: int = Field(ge=0)


class SecurityAuditEventOut(BaseModel):
    id: str
    event_type: str
    outcome: str
    actor_username: str | None
    target_username: str | None
    workspace_id: str | None
    client_ip: str
    user_agent: str
    metadata: dict
    created_at: datetime


class SecurityAuditListOut(BaseModel):
    items: list[SecurityAuditEventOut]
    total: int
    page: int
    page_size: int


class WorkspaceListItem(WorkspaceOut):
    owner_username: str
    owner_display_name: str


class WorkspaceListOut(BaseModel):
    items: list[WorkspaceListItem]
    total: int
    page: int
    page_size: int


class WorkspaceSwitchIn(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=36)


class WorkspacePatchIn(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    visibility: Literal["private", "public"]
    expected_revision: int = Field(ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Workspace 名称不能为空")
        return normalized


class WorkspaceMemberOut(BaseModel):
    membership_id: str
    user_id: str
    username: str
    display_name: str
    role: Literal["owner", "member"]
    revision: int
    joined_at: datetime


class WorkspaceMemberListOut(BaseModel):
    items: list[WorkspaceMemberOut]
    total: int


class WorkspaceMemberRemoveIn(BaseModel):
    expected_revision: int = Field(ge=0)


class WorkspaceInvitationCreateIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class WorkspaceInvitationActionIn(BaseModel):
    expected_revision: int = Field(ge=0)


class WorkspaceInvitationOut(BaseModel):
    id: str
    workspace_id: str
    workspace_name: str
    invitee_user_id: str
    invitee_username: str
    invitee_display_name: str
    inviter_username: str | None
    status: Literal["pending", "accepted", "declined", "revoked", "expired"]
    expires_at: datetime
    responded_at: datetime | None
    revision: int
    created_at: datetime


class WorkspaceInvitationListOut(BaseModel):
    items: list[WorkspaceInvitationOut]
    total: int
