from sqlalchemy import JSON, ForeignKey, Index, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base


class WorkbenchProject(Base):
    __tablename__ = "workbench_projects"
    __table_args__ = (UniqueConstraint("owner_user_id", "root"),)

    id: Mapped[str] = mapped_column(primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    root: Mapped[str]
    last_used_at: Mapped[int]


Index(
    "ix_workbench_projects_recent",
    WorkbenchProject.owner_user_id,
    WorkbenchProject.last_used_at.desc(),
    WorkbenchProject.id,
)


class WorkbenchChat(Base):
    __tablename__ = "workbench_chats"

    id: Mapped[str] = mapped_column(primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[str]
    agent_id: Mapped[str]
    created_at: Mapped[int]
    queue_paused: Mapped[bool] = mapped_column(default=False)


class WorkbenchTurn(Base):
    __tablename__ = "workbench_turns"

    id: Mapped[str] = mapped_column(primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    chat_id: Mapped[str] = mapped_column(ForeignKey("workbench_chats.id"))
    client_id: Mapped[str]
    position: Mapped[int]
    prompt: Mapped[str]
    answer: Mapped[str]
    status: Mapped[str]
    error: Mapped[str | None]
    approvals: Mapped[list[dict]] = mapped_column(JSON)
    revision: Mapped[int]
    started_at: Mapped[int | None]
    queued_session_id: Mapped[str | None]
    queued_local: Mapped[bool] = mapped_column(default=False)
    activity: Mapped[list[dict]] = mapped_column(JSON, default=list)
    instructions: Mapped[list[dict]] = mapped_column(JSON, default=list)
