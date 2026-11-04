"""Tools-owned host queue; the Mac worker receives a sanitized lease."""

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from fpl_runtime.native_records import NativeJobFields


class ToolsNativeBase(DeclarativeBase):
    pass


class ToolsNativeJob(NativeJobFields, ToolsNativeBase):
    __tablename__ = "tools_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
