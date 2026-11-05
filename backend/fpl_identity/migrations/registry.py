"""Explicit Identity schema sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as MANAGEMENT_SESSIONS
from .versions.v0003 import SQL as MODEL_AUDIT_RECEIPTS
from .versions.v0004 import SQL as MODEL_AUDIT_INTENTS
from .versions.v0005 import SQL as INTEGRATION_INTENTS
from .versions.v0006 import SQL as CERTIFICATION_AUDIT
from .versions.v0007 import SQL as IMPORT_RECEIPTS
from .versions.v0008 import SQL as CLOUD_FACTORS

MIGRATIONS = (Migration("0001_identity", SQL),)

MIGRATIONS += (Migration("0002_management_sessions", MANAGEMENT_SESSIONS),)

MIGRATIONS += (Migration("0003_model_audit_receipts", MODEL_AUDIT_RECEIPTS),)

MIGRATIONS += (Migration("0004_model_audit_intents", MODEL_AUDIT_INTENTS),)

MIGRATIONS += (Migration("0005_integration_intents", INTEGRATION_INTENTS),)

MIGRATIONS += (Migration("0006_certification_audit", CERTIFICATION_AUDIT),)

MIGRATIONS += (Migration("0007_identity_import_receipts", IMPORT_RECEIPTS),)

MIGRATIONS += (Migration("0008_identity_cloud_factors", CLOUD_FACTORS),)
