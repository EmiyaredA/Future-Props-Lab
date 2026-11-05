"""Remote's durable cloud setup decisions and Mac receipts."""

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from fpl_runtime.native_records import NativeJobFields


class RemoteSetupBase(DeclarativeBase):
    pass


class RemoteSetupJob(NativeJobFields, RemoteSetupBase):
    __tablename__ = "remote_setup_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)
