"""Explicit schema sequence for the independent Amadeus owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as RECORDS
from .versions.v0002 import SQL as NATIVE

MIGRATIONS = (
    Migration("0001_amadeus_records", RECORDS),
    Migration("0002_amadeus_native_jobs", NATIVE),
)
