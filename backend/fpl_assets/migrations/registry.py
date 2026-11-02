"""Independent Assets migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as SQL_0001
from .versions.v0002 import SQL as SQL_0002

MIGRATIONS = (Migration("0001_assets", SQL_0001), Migration("0002_prepared_references", SQL_0002))
