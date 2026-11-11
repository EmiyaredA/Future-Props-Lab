from studio.apps.model_service.storage.migrations.versions.v0001 import SQL as SQL_0001
from studio.apps.model_service.storage.migrations.versions.v0002 import SQL as SQL_0002
from studio.apps.model_service.storage.migrations.versions.v0003 import SQL as SQL_0003
from studio.apps.model_service.storage.migrations.versions.v0004 import SQL as SQL_0004
from studio.apps.model_service.storage.migrations.versions.v0005 import SQL as SQL_0005
from studio.apps.model_service.storage.migrations.versions.v0006 import SQL as SQL_0006
from studio.apps.model_service.storage.migrations.versions.v0007 import SQL as SQL_0007
from studio.apps.model_service.storage.migrations.versions.v0008 import SQL as SQL_0008
from studio.apps.model_service.storage.migrations.versions.v0009 import SQL as SQL_0009
from studio.apps.model_service.storage.migrations.versions.v0010 import SQL as SQL_0010
from studio.apps.model_service.storage.migrations.versions.v0011 import SQL as SQL_0011
from studio.apps.model_service.storage.migrations.versions.v0012 import SQL as SQL_0012
from studio.apps.model_service.storage.migrations.versions.v0013 import SQL as SQL_0013
from studio.apps.model_service.storage.migrations.versions.v0014 import SQL as SQL_0014
from studio.apps.model_service.storage.migrations.versions.v0015 import SQL as SQL_0015
from studio.apps.model_service.storage.migrations.versions.v0016 import SQL as SQL_0016
from studio.apps.model_service.storage.migrations.versions.v0017 import SQL as SQL_0017
from studio.apps.model_service.storage.migrations.versions.v0018 import SQL as SQL_0018
from studio.apps.model_service.storage.migrations.versions.v0019 import SQL as VISUAL_ASSISTANT_RUNS
from studio.apps.model_service.storage.migrations.versions.v0020 import SQL as ASSISTANT_ATTRIBUTION
from studio.apps.model_service.storage.migrations.versions.v0021 import (
    SQL as RETIRE_VISUAL_DIALOGUE,
)
from studio.apps.model_service.storage.migrations.versions.v0022 import SQL as VIDEO_ENHANCEMENT
from studio.runtime.database.migrations import Migration

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
    Migration("0020_visual_assistant_attribution", ASSISTANT_ATTRIBUTION),
    Migration("0021_retire_visual_conversations", RETIRE_VISUAL_DIALOGUE),
    Migration("0022_video_enhancement", VIDEO_ENHANCEMENT),
)
