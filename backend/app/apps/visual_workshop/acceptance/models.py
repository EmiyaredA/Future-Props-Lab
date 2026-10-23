from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class AcceptanceTemplate(Base):
    __tablename__ = "visual_acceptance_templates"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    title: Mapped[str] = mapped_column(String(120))
    document: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AcceptanceStandard(Base):
    __tablename__ = "visual_acceptance_standards"
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), primary_key=True
    )
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    draft: Mapped[dict] = mapped_column(JSON)
    published_version: Mapped[int] = mapped_column(Integer, default=0)
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class AcceptanceStandardVersion(Base):
    __tablename__ = "visual_acceptance_standard_versions"
    __table_args__ = (UniqueConstraint("project_id", "version"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    version: Mapped[int] = mapped_column(Integer)
    document: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class AcceptanceRun(Base):
    __tablename__ = "visual_acceptance_runs"
    __table_args__ = (UniqueConstraint("project_id", "request_id", "output_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), index=True
    )
    node_id: Mapped[str] = mapped_column(String(64))
    output_id: Mapped[str] = mapped_column(
        ForeignKey("visual_node_outputs.id", ondelete="RESTRICT")
    )
    standard_id: Mapped[str] = mapped_column(
        ForeignKey("visual_acceptance_standard_versions.id", ondelete="RESTRICT")
    )
    previous_run_id: Mapped[str | None] = mapped_column(String(36))
    request_id: Mapped[str] = mapped_column(String(100))
    fingerprint: Mapped[str] = mapped_column(String(64))
    model_id: Mapped[str | None] = mapped_column(String(36))
    scheme_id: Mapped[str] = mapped_column(String(64), default="legacy")
    execution_result: Mapped[dict] = mapped_column(JSON, default=dict)
    status: Mapped[str] = mapped_column(String(24), default="queued")
    decision: Mapped[str] = mapped_column(String(24), default="pending")
    snapshot: Mapped[dict] = mapped_column(JSON)
    results: Mapped[list[dict]] = mapped_column(JSON, default=list)
    evidence: Mapped[list[dict]] = mapped_column(JSON, default=list)
    decisions: Mapped[list[dict]] = mapped_column(JSON, default=list)
    error_message: Mapped[str | None] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class AcceptanceAssetReference(Base):
    __tablename__ = "visual_acceptance_asset_references"
    owner_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    asset_id: Mapped[str] = mapped_column(
        ForeignKey("visual_assets.id", ondelete="RESTRICT"), primary_key=True
    )
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE"), index=True
    )


class NodeAcceptanceBinding(Base):
    __tablename__ = "visual_node_acceptance_bindings"
    __table_args__ = (UniqueConstraint("project_id", "node_id"),)
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    node_id: Mapped[str] = mapped_column(String(64))
    scheme_id: Mapped[str | None] = mapped_column(String(64))
    revision: Mapped[int] = mapped_column(Integer, default=0)


class AcceptanceRepairDraft(Base):
    __tablename__ = "visual_acceptance_repair_drafts"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True)
    project_id: Mapped[str] = mapped_column(
        ForeignKey("visual_workshop_projects.id", ondelete="CASCADE")
    )
    run_id: Mapped[str] = mapped_column(ForeignKey("visual_acceptance_runs.id", ondelete="CASCADE"))
    text: Mapped[str] = mapped_column(Text)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    prompt_version_id: Mapped[str | None] = mapped_column(String(64))
