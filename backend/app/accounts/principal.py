from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from app.accounts.permissions import effective_permissions


@dataclass(frozen=True)
class StudioPrincipal:
    user_id: str
    workspace_id: str
    workspace_access: Literal["owner", "member", "platform_admin", "public_viewer"]
    member_role: Literal["owner", "admin", "member", "viewer"] | None
    is_platform_admin: bool
    must_change_password: bool
    auth_kind: Literal["session", "management_api_key"]
    scopes: frozenset[str]
    membership_id: str | None = None
    session_id: str | None = None
    api_key_id: str | None = None
    reauthenticated_at: datetime | None = None

    platform_role: str = ""
    platform_permissions: frozenset[str] = frozenset()
    policy_revision: int = 0

    @property
    def can_manage_all_workspaces(self) -> bool:
        return self.is_platform_admin or self.platform_role in {"super_admin", "admin"}

    @property
    def permission_keys(self) -> frozenset[str]:
        permissions = effective_permissions(self.workspace_access, self.member_role, self.scopes)
        if "content.read" in permissions:
            permissions |= self.platform_permissions - {"projects.certify"}
        if "content.write" in permissions and "studio:write" in self.scopes:
            permissions |= self.platform_permissions & {"projects.certify"}
        return permissions

    def allows(self, permission: str) -> bool:
        return permission in self.permission_keys

    def permits(self, scope: str) -> bool:
        return scope in self.scopes
