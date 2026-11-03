"""Independent Assets migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as SQL_0001
from .versions.v0002 import SQL as SQL_0002
from .versions.v0003 import SQL as SQL_0003
from .versions.v0004 import SQL as SQL_0004

MIGRATIONS = (
    Migration("0001_assets", SQL_0001),
    Migration("0002_prepared_references", SQL_0002),
    Migration("0003_project_file_links", SQL_0003),
    Migration("0004_model_output_receipts", SQL_0004),
)
