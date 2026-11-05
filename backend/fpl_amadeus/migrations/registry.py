"""Explicit schema sequence for the independent Amadeus owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_amadeus_records", SQL),)
