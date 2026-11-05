"""Explicit schema sequence for the independent Amadeus owner."""

from studio.apps.amadeus.storage.migrations.versions.v0001 import SQL as RECORDS
from studio.apps.amadeus.storage.migrations.versions.v0002 import SQL as NATIVE
from studio.apps.amadeus.storage.migrations.versions.v0003 import SQL as IMPORTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_amadeus_records", RECORDS),
    Migration("0002_amadeus_native_jobs", NATIVE),
    Migration("0003_import_receipts", IMPORTS),
)
