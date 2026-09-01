from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    username: Mapped[str] = mapped_column(String(64))
    username_normalized: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), default="")
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    email_normalized: Mapped[str | None] = mapped_column(String(254), nullable=True, unique=True)
    avatar_relative_path: Mapped[str] = mapped_column(String(512), default="")
    avatar_content_type: Mapped[str] = mapped_column(String(64), default="")
    avatar_content_sha256: Mapped[str] = mapped_column(String(64), default="")
    password_hash: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    is_platform_admin: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class WorkspaceMembership(Base):
    __tablename__ = "workspace_memberships"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[str] = mapped_column(String(16), default="owner")
    status: Mapped[str] = mapped_column(String(16), default="active", index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    __table_args__ = (
        Index("ix_auth_sessions_user_active", "user_id", "revoked_at", "absolute_expires_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    active_workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="RESTRICT"), index=True
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_hash: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    idle_expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    absolute_expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    reauthenticated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(500), default="")


class WorkspaceInvitation(Base):
    __tablename__ = "workspace_invitations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    invitee_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    invited_by_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    responded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ManagementApiKey(Base):
    __tablename__ = "management_api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    workspace_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(64))
    key_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    key_prefix: Mapped[str] = mapped_column(String(16))
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[datetime] = mapped_column(DateTime, index=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class SecurityAuditEvent(Base):
    __tablename__ = "security_audit_events"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    actor_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_user_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    workspace_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("workspaces.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(64), index=True)
    outcome: Mapped[str] = mapped_column(String(16), default="success", index=True)
    client_ip: Mapped[str] = mapped_column(String(64), default="")
    user_agent: Mapped[str] = mapped_column(String(500), default="")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)


__all__ = [
    "AuthSession",
    "ManagementApiKey",
    "SecurityAuditEvent",
    "User",
    "WorkspaceInvitation",
    "WorkspaceMembership",
]
