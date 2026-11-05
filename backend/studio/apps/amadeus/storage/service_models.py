"""Amadeus owns conversations, runs, questions, actions and event receipts."""

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from studio.apps.amadeus.storage.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from studio.runtime.database.native_records import NativeJobFields


class AmadeusNativeBase(DeclarativeBase):
    pass


class AmadeusNativeJob(NativeJobFields, AmadeusNativeBase):
    __tablename__ = "amadeus_native_jobs"
    __table_args__ = (UniqueConstraint("owner_user_id", "request_id"),)


MODELS = (
    AmadeusNativeJob,
    AmadeusConversation,
    AmadeusRun,
    AmadeusMessage,
    AmadeusAction,
    AmadeusQuestion,
    AmadeusRunEvent,
)
