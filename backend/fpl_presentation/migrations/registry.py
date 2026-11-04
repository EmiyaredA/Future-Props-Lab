"""Versioned schema for the Presentation owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_presentation", SQL),)
