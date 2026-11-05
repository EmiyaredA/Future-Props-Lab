from fpl_runtime.migrations import Migration

from .versions.v0001 import SQL as SQL_0001
from .versions.v0002 import SQL as SQL_0002
from .versions.v0003 import SQL as SQL_0003
from .versions.v0004 import SQL as SQL_0004
from .versions.v0005 import SQL as SQL_0005
from .versions.v0006 import SQL as SQL_0006
from .versions.v0007 import SQL as SQL_0007
from .versions.v0008 import SQL as SQL_0008
from .versions.v0009 import SQL as SQL_0009
from .versions.v0010 import SQL as SQL_0010
from .versions.v0011 import SQL as SQL_0011
from .versions.v0012 import SQL as SQL_0012
from .versions.v0013 import SQL as SQL_0013
from .versions.v0014 import SQL as SQL_0014
from .versions.v0015 import SQL as SQL_0015
from .versions.v0016 import SQL as SQL_0016
from .versions.v0017 import SQL as SQL_0017
from .versions.v0018 import SQL as SQL_0018
from .versions.v0019 import SQL as VISUAL_ASSISTANT_RUNS

MIGRATIONS = (
    Migration("0001_account_defaults", SQL_0001),
    Migration("0002_model_capabilities", SQL_0002),
    Migration("0003_catalog_provisioning", SQL_0003),
    Migration("0004_role_templates", SQL_0004),
    Migration("0005_quota_policy", SQL_0005),
    Migration("0006_task_authorizations", SQL_0006),
    Migration("0007_governance", SQL_0007),
    Migration("0008_native_models", SQL_0008),
    Migration("0009_audit_delivery", SQL_0009),
    Migration("0010_integration_capacity", SQL_0010),
    Migration("0011_demo_installations", SQL_0011),
    Migration("0012_native_result_retention", SQL_0012),
    Migration("0013_annotation_transcription_receipts", SQL_0013),
    Migration("0014_models_import_receipts", SQL_0014),
    Migration("0015_policy_creation_timestamps", SQL_0015),
    Migration("0016_galgame_transcription_receipts", SQL_0016),
    Migration("0017_visual_provider_dispatch", SQL_0017),
    Migration("0018_visual_model_reviews", SQL_0018),
    Migration("0019_visual_assistant_model_runs", VISUAL_ASSISTANT_RUNS),
)
