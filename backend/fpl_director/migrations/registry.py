"""Explicit schema registration for the Director owner."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_director", SQL),)
