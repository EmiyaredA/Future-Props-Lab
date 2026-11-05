"""Explicit schema registration for Interview."""

from studio.apps.interview_assistant.storage.migrations.versions.v0001 import SQL as INITIAL
from studio.apps.interview_assistant.storage.migrations.versions.v0002 import SQL as NATIVE_LEASES
from studio.apps.interview_assistant.storage.migrations.versions.v0003 import SQL as IMPORTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_interview", INITIAL),
    Migration("0002_interview_native_leases", NATIVE_LEASES),
    Migration("0003_import_receipts", IMPORTS),
)
