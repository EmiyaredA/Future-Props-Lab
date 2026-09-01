from datetime import UTC, datetime
from uuid import uuid4


def new_id() -> str:
    """Return a persistence-layer identifier without depending on runtime core."""

    return str(uuid4())


def utc_now() -> datetime:
    """Return the naive UTC value used by SQLite timestamp columns."""

    return datetime.now(UTC).replace(tzinfo=None)
