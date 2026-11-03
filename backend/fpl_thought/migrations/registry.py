"""Thought owns an independent, append-only migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as RETENTION

MIGRATIONS = (
    Migration("0001_thought_documents", SQL),
    Migration("0002_reference_mutations", RETENTION),
)
