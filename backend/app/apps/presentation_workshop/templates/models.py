"""account-owned templates, complete examples and their protected asset references."""

from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.ids import new_id
from app.runtime.orm_base import Base, external_id
from app.runtime.time import utc_now


class PresentationTemplate(Base):
    __tablename__ = "presentation_templates"
    __table_args__ = (
        Index("ix_presentation_templates_account_updated", "owner_user_id", "updated_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users"), ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000), default="")
    definition: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PresentationExample(Base):
    __tablename__ = "presentation_examples"
    __table_args__ = (
        Index("ix_presentation_examples_account_updated", "owner_user_id", "updated_at"),
    )
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users"), ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    description: Mapped[str] = mapped_column(String(1000), default="")
    document: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PresentationTemplateAsset(Base):
    __tablename__ = "presentation_template_assets"
    __table_args__ = (Index("ix_presentation_template_assets_asset", "asset_id"),)
    template_id: Mapped[str] = mapped_column(
        ForeignKey("presentation_templates.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )


class PresentationExampleAsset(Base):
    __tablename__ = "presentation_example_assets"
    __table_args__ = (Index("ix_presentation_example_assets_asset", "asset_id"),)
    example_id: Mapped[str] = mapped_column(
        ForeignKey("presentation_examples.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), primary_key=True
    )
