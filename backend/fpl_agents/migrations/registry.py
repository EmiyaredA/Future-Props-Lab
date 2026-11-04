"""Workbench schema sequence, independent of legacy migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as EXECUTION_TRANSCRIPTS

MIGRATIONS = (
    Migration("0001_agents", SQL),
    Migration("0002_workbench_transcripts", EXECUTION_TRANSCRIPTS),
)
