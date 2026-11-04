from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base


class WorkbenchChat(Base):
    __tablename__ = "workbench_chats"

    id: Mapped[str] = mapped_column(primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    project_id: Mapped[str]
    agent_id: Mapped[str]
    created_at: Mapped[int]


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
