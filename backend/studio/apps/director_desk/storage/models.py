from datetime import datetime

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base, external_id
from studio.runtime.ids import new_id
from studio.runtime.time import utc_now


class DirectorDeskUserMotion(Base):
    __tablename__ = "director_desk_user_motions"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "motion_key"),
        Index("ix_director_desk_user_motions_account_name", "owner_user_id", "name"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users"), ondelete="CASCADE"))
    motion_key: Mapped[str] = mapped_column(String(200))
    name: Mapped[str] = mapped_column(String(100))
    motion: Mapped[dict] = mapped_column(JSON)
    resource: Mapped[dict] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)


class DirectorDeskProject(Base):
    __tablename__ = "director_desk_projects"
    __table_args__ = (
        Index("ix_director_desk_projects_account_updated", "owner_user_id", "updated_at"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=new_id)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users"), ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(120))
    document: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
