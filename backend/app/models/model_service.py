from __future__ import annotations

from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.models.defaults import new_id, utc_now
from app.runtime.orm_base import Base


class ModelProvider(Base):
    __tablename__ = "model_providers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    origin: Mapped[str] = mapped_column(String(20), default="user")
    template_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(String(120))
    supplier_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("model_suppliers.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    kind: Mapped[str] = mapped_column(String(24))
    base_url: Mapped[str] = mapped_column(String(512), default="")
    api_key_ciphertext: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelEntry(Base):
    __tablename__ = "model_entries"
    __table_args__ = (
        UniqueConstraint("provider_id", "slug", name="uq_model_entries_provider_slug"),
        Index("ix_model_entries_provider_order", "provider_id", "sort_order"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    workspace_id: Mapped[str] = mapped_column(String(36), index=True, default="default")
    provider_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("model_providers.id", ondelete="CASCADE"), index=True
    )
    origin: Mapped[str] = mapped_column(String(20), default="user")
    template_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    slug: Mapped[str] = mapped_column(String(160))
    label: Mapped[str] = mapped_column(String(160), default="")
    description: Mapped[str] = mapped_column(String(255), default="")
    capabilities: Mapped[list[str]] = mapped_column(JSON, default=list)
    categories: Mapped[list[str]] = mapped_column(JSON, default=list)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)


class ModelCatalogState(Base):
    __tablename__ = "model_catalog_state"

    workspace_id: Mapped[str] = mapped_column("id", String(36), primary_key=True, default="default")
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now, onupdate=utc_now)
