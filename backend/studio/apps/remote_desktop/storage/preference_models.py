from sqlalchemy import ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from studio.runtime.database.orm_base import Base, external_id


class DesktopPreference(Base):
    __tablename__ = "cloud_desktop_preferences"

    owner_user_id: Mapped[str] = mapped_column(ForeignKey(external_id("users")), primary_key=True)
    idle_minutes: Mapped[int]
    revision: Mapped[int]
