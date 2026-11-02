"""Explicit Identity schema sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as MANAGEMENT_SESSIONS

MIGRATIONS = (Migration("0001_identity", SQL),)

MIGRATIONS += (Migration("0002_management_sessions", MANAGEMENT_SESSIONS),)
