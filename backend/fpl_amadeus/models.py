"""Amadeus owns conversations, runs, questions, actions and event receipts."""

from app.console.amadeus.models import (
    AmadeusAction,
    AmadeusConversation,
    AmadeusMessage,
    AmadeusQuestion,
    AmadeusRun,
    AmadeusRunEvent,
)

MODELS = (
    AmadeusConversation,
    AmadeusRun,
    AmadeusMessage,
    AmadeusAction,
    AmadeusQuestion,
    AmadeusRunEvent,
)
