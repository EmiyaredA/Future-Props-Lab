"""Explicit Galgame database migrations."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as STORY_RETENTION
from .versions.v0003 import SQL as STORY_OPERATIONS

MIGRATIONS = (
    Migration("0001_galgame_owned_projects", SQL),
    Migration("0002_story_reference_mutations", STORY_RETENTION),
    Migration("0003_story_operation_receipts", STORY_OPERATIONS),
)
