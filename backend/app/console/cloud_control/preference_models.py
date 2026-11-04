from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.runtime.orm_base import Base


class DesktopPreference(Base):
    __tablename__ = "cloud_desktop_preferences"

    owner_user_id: Mapped[str] = mapped_column(ForeignKey("users.id"), primary_key=True)
    idle_minutes: Mapped[int]
    revision: Mapped[int]
