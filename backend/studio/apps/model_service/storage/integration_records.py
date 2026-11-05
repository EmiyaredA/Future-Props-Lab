"""Models owns fixed foreign validation reservations independently of executor state."""

from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from studio.apps.model_service.orm import ModelsBase
from studio.runtime.time import utc_now


class IntegrationCapacity(ModelsBase):
    __tablename__ = "model_integration_capacity"
    intent_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String(36), index=True)
    fingerprint: Mapped[str] = mapped_column(String(64))
    lease_id: Mapped[str] = mapped_column(String(36), unique=True)
    outcome: Mapped[str] = mapped_column(String(24), default="")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utc_now)
