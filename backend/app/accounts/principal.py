from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Literal


@dataclass(frozen=True)
class StudioPrincipal:
    user_id: str
    workspace_id: str
    workspace_access: Literal["owner", "member", "platform_admin", "public_viewer"]
    member_role: Literal["owner", "member"] | None
    is_platform_admin: bool
    must_change_password: bool
    auth_kind: Literal["session", "management_api_key"]
    scopes: frozenset[str]
    membership_id: str | None = None
    session_id: str | None = None
    api_key_id: str | None = None
    reauthenticated_at: datetime | None = None

    def permits(self, scope: str) -> bool:
        return scope in self.scopes
