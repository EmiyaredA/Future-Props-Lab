"""Agent Runtime owns native connection requests and their receipts."""

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from studio.runtime.database.native_records import NativeJobFields


class RuntimeBase(DeclarativeBase):
    pass


class ConnectionJob(NativeJobFields, RuntimeBase):
    __tablename__ = "agent_runtime_connection_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)


class VisualReviewJob(NativeJobFields, RuntimeBase):
    __tablename__ = "agent_runtime_visual_review_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
