"""Amadeus owns conversations, runs, questions, actions and event receipts."""

from sqlalchemy import UniqueConstraint
from sqlalchemy.orm import DeclarativeBase

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)
from fpl_runtime.native_records import NativeJobFields


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
