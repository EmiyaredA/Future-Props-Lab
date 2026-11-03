"""Explicit Identity schema sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as MANAGEMENT_SESSIONS
from .versions.v0003 import SQL as MODEL_AUDIT_RECEIPTS
from .versions.v0004 import SQL as MODEL_AUDIT_INTENTS
from .versions.v0005 import SQL as INTEGRATION_INTENTS

MIGRATIONS = (Migration("0001_identity", SQL),)

MIGRATIONS += (Migration("0002_management_sessions", MANAGEMENT_SESSIONS),)

MIGRATIONS += (Migration("0003_model_audit_receipts", MODEL_AUDIT_RECEIPTS),)

MIGRATIONS += (Migration("0004_model_audit_intents", MODEL_AUDIT_INTENTS),)

MIGRATIONS += (Migration("0005_integration_intents", INTEGRATION_INTENTS),)
