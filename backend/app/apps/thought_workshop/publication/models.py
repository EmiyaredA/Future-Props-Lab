"""Explicit publication registry; never grants access to a source account."""

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.apps.thought_workshop.foreign_keys import external_id
from app.runtime.ids import new_id
from app.runtime.orm_base import Base
from app.runtime.time import utc_now


class Publication(Base):
    __tablename__ = "thought_publications"
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), index=True
    )
    knowledge_base_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_knowledge_bases.id", ondelete="CASCADE"), unique=True
    )
    publisher_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="RESTRICT")
    )
    title: Mapped[str] = mapped_column(String(240))
    description: Mapped[str] = mapped_column(Text, default="")
    cover_asset_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="RESTRICT"), nullable=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    is_official: Mapped[bool] = mapped_column(Boolean, default=False)
    read_only: Mapped[bool] = mapped_column(Boolean, default=True)
    editable_platform_roles: Mapped[list] = mapped_column(JSON, default=list)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class PublishedArticle(Base):
    __tablename__ = "thought_published_articles"
    publication_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_publications.id", ondelete="CASCADE"), primary_key=True
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    visibility: Mapped[str] = mapped_column(String(16), default="public")
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    revision: Mapped[int] = mapped_column(Integer, default=0)


class ArticleMember(Base):
    __tablename__ = "thought_article_members"
    publication_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_publications.id", ondelete="CASCADE"), primary_key=True
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), primary_key=True
    )
    role: Mapped[str] = mapped_column(String(16))


class CommunityFavorite(Base):
    __tablename__ = "thought_community_favorites"
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), primary_key=True
    )
    resource_id: Mapped[str] = mapped_column(String(200), primary_key=True)


class CommunityUpload(Base):
    __tablename__ = "thought_community_uploads"
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    asset_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("visual_assets"), ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE")
    )


class OfficialSource(Base):
    """Import provenance only; content remains an ordinary account note."""

    __tablename__ = "thought_official_sources"
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("thought_notes.id", ondelete="CASCADE"), primary_key=True
    )
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), index=True
    )
    library_key: Mapped[str] = mapped_column(String(80), index=True)
    document_key: Mapped[str] = mapped_column(String(80))


class OfficialImportReceipt(Base):
    __tablename__ = "thought_official_import_receipts"
    owner_user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey(external_id("users"), ondelete="CASCADE"), primary_key=True
    )
    request_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    package_version: Mapped[str] = mapped_column(String(64))
    result: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
