"""Creative owns a separately registered, explicit migration sequence."""

from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL
from .versions.v0002 import SQL as INSTALL_SQL
from .versions.v0003 import SQL as FENCE_SQL
from .versions.v0004 import SQL as CANCEL_SQL

MIGRATIONS = (
    Migration("0001_creative_catalog", SQL),
    Migration("0002_creative_install_operations", INSTALL_SQL),
    Migration("0003_install_fences", FENCE_SQL),
    Migration("0004_install_cancellations", CANCEL_SQL),
)
