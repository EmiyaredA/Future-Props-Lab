from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal

from studio.contracts.identity.permissions import effective_permissions


@dataclass(frozen=True)
class StudioPrincipal:
    user_id: str
    must_change_password: bool
    auth_kind: Literal["session", "management_api_key"]
    scopes: frozenset[str]
    platform_role: Literal["admin", "user"] = "user"
    session_id: str | None = None
    api_key_id: str | None = None
    reauthenticated_at: datetime | None = None

    @property
    def owner_user_id(self) -> str:
        return self.user_id

    @property
    def is_platform_admin(self) -> bool:
        return self.platform_role == "admin"

    @property
    def permission_keys(self) -> frozenset[str]:
        return effective_permissions(self.platform_role, self.scopes)

    @property
    def platform_permissions(self) -> frozenset[str]:
        return self.permission_keys

    def allows(self, permission: str) -> bool:
        return permission in self.permission_keys

    def permits(self, scope: str) -> bool:
        return scope in self.scopes
