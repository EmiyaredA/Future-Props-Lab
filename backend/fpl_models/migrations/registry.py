from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as SQL_0001
from .versions.v0002 import SQL as SQL_0002
from .versions.v0003 import SQL as SQL_0003
from .versions.v0004 import SQL as SQL_0004
from .versions.v0005 import SQL as SQL_0005
from .versions.v0006 import SQL as SQL_0006

MIGRATIONS = (
    Migration("0001_account_defaults", SQL_0001),
    Migration("0002_model_capabilities", SQL_0002),
    Migration("0003_catalog_provisioning", SQL_0003),
    Migration("0004_role_templates", SQL_0004),
    Migration("0005_quota_policy", SQL_0005),
    Migration("0006_task_authorizations", SQL_0006),
)
