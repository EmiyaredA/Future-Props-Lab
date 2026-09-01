from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base
from app.models.defaults import new_id, utc_now


class ToolApiIntegration(Base):
    __tablename__ = "integration_tool_apis"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_integration_tool_apis_workspace_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(500), default="")
    method: Mapped[str] = mapped_column(String(8))
    url: Mapped[str] = mapped_column(String(1024))
    auth_kind: Mapped[str] = mapped_column(String(16), default="none")
    auth_header_name: Mapped[str] = mapped_column(String(120), default="")
    secret_ciphertext: Mapped[str] = mapped_column(Text, default="")
    parameters_schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    query_template: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    body_template: Mapped[Any | None] = mapped_column(JSON, nullable=True)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="unchecked")
    status_message: Mapped[str] = mapped_column(String(500), default="")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class McpIntegration(Base):
    __tablename__ = "integration_mcp_servers"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_integration_mcp_workspace_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(500), default="")
    transport: Mapped[str] = mapped_column(String(24))
    url: Mapped[str] = mapped_column(String(1024), default="")
    command: Mapped[str] = mapped_column(String(1024), default="")
    arguments: Mapped[list[str]] = mapped_column(JSON, default=list)
    bearer_ciphertext: Mapped[str] = mapped_column(Text, default="")
    environment_ciphertext: Mapped[str] = mapped_column(Text, default="")
    environment_keys: Mapped[list[str]] = mapped_column(JSON, default=list)
    tags: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    status: Mapped[str] = mapped_column(String(16), default="unchecked")
    status_message: Mapped[str] = mapped_column(String(500), default="")
    server_name: Mapped[str] = mapped_column(String(160), default="")
    server_version: Mapped[str] = mapped_column(String(80), default="")
    protocol_version: Mapped[str] = mapped_column(String(80), default="")
    last_checked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class McpDiscoveredTool(Base):
    __tablename__ = "integration_mcp_tools"
    __table_args__ = (
        UniqueConstraint("server_id", "name", name="uq_integration_mcp_tools_server_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    server_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integration_mcp_servers.id", ondelete="CASCADE"), index=True
    )
    name: Mapped[str] = mapped_column(String(160))
    description: Mapped[str] = mapped_column(String(1000), default="")
    input_schema: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class SkillIntegration(Base):
    __tablename__ = "integration_skills"
    __table_args__ = (
        UniqueConstraint("workspace_id", "name", name="uq_integration_skills_workspace_name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000), default="")
    default_version: Mapped[str] = mapped_column(String(24), default="v1")
    latest_version: Mapped[str] = mapped_column(String(24), default="v1")
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(16), default="healthy")
    status_message: Mapped[str] = mapped_column(String(500), default="")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class SkillVersion(Base):
    __tablename__ = "integration_skill_versions"
    __table_args__ = (
        UniqueConstraint("skill_id", "version", name="uq_integration_skill_versions_skill_version"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    skill_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("integration_skills.id", ondelete="CASCADE"), index=True
    )
    version: Mapped[str] = mapped_column(String(24))
    name: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000), default="")
    storage_path: Mapped[str] = mapped_column(String(1024))
    content_sha256: Mapped[str] = mapped_column(String(64))
    file_count: Mapped[int] = mapped_column(Integer)
    expanded_bytes: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class IntegrationCheck(Base):
    __tablename__ = "integration_checks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    resource_kind: Mapped[str] = mapped_column(String(24), index=True)
    resource_id: Mapped[str] = mapped_column(String(36), index=True)
    resource_name: Mapped[str] = mapped_column(String(120))
    ok: Mapped[bool] = mapped_column(Boolean)
    status_code: Mapped[int | None] = mapped_column(Integer, nullable=True)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    summary: Mapped[str] = mapped_column(String(500), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, index=True)
