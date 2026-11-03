"""Thought owns an independent, append-only migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL

MIGRATIONS = (Migration("0001_thought_documents", SQL),)
