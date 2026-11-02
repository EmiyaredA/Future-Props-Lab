from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as SQL_0001
from .versions.v0002 import SQL as SQL_0002

MIGRATIONS = (
    Migration("0001_account_defaults", SQL_0001),
    Migration("0002_model_capabilities", SQL_0002),
)
