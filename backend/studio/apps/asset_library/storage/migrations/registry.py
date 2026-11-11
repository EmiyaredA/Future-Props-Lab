"""Independent Assets migration sequence."""

from studio.apps.asset_library.storage.migrations.versions.v0001 import SQL as SQL_0001
from studio.apps.asset_library.storage.migrations.versions.v0002 import SQL as SQL_0002
from studio.apps.asset_library.storage.migrations.versions.v0003 import SQL as SQL_0003
from studio.apps.asset_library.storage.migrations.versions.v0004 import SQL as SQL_0004
from studio.apps.asset_library.storage.migrations.versions.v0005 import SQL as SQL_0005
from studio.apps.asset_library.storage.migrations.versions.v0006 import SQL as SQL_0006
from studio.apps.asset_library.storage.migrations.versions.v0007 import SQL as SQL_0007
from studio.apps.asset_library.storage.migrations.versions.v0008 import SQL as SQL_0008
from studio.apps.asset_library.storage.migrations.versions.v0009 import SQL as SQL_0009
from studio.apps.asset_library.storage.migrations.versions.v0010 import SQL as SQL_0010
from studio.apps.asset_library.storage.migrations.versions.v0011 import SQL as SQL_0011
from studio.apps.asset_library.storage.migrations.versions.v0012 import SQL as SQL_0012
from studio.apps.asset_library.storage.migrations.versions.v0013 import SQL as SQL_0013
from studio.apps.asset_library.storage.migrations.versions.v0014 import SQL as SQL_0014
from studio.apps.asset_library.storage.migrations.versions.v0015 import SQL as SQL_0015
from studio.apps.asset_library.storage.migrations.versions.v0016 import SQL as SQL_0016
from studio.apps.asset_library.storage.migrations.versions.v0017 import SQL as SQL_0017
from studio.apps.asset_library.storage.migrations.versions.v0018 import SQL as SQL_0018
from studio.apps.asset_library.storage.migrations.versions.v0019 import SQL as SQL_0019
from studio.apps.asset_library.storage.migrations.versions.v0020 import (
    SQL as RETIRE_VISUAL_DIALOGUE,
)
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_assets", SQL_0001),
    Migration("0002_prepared_references", SQL_0002),
    Migration("0003_project_file_links", SQL_0003),
    Migration("0004_model_output_receipts", SQL_0004),
    Migration("0005_thought_upload_receipts", SQL_0005),
    Migration("0006_thought_archive_staging", SQL_0006),
    Migration("0007_asset_import_receipts", SQL_0007),
    Migration("0008_presentation_archive_staging", SQL_0008),
    Migration("0009_motion_file_write_receipts", SQL_0009),
    Migration("0010_motion_archive_staging", SQL_0010),
    Migration("0011_video_file_write_receipts", SQL_0011),
    Migration("0012_video_archive_staging", SQL_0012),
    Migration("0013_video_segment_handoff", SQL_0013),
    Migration("0014_video_output_history", SQL_0014),
    Migration("0015_galgame_upload_receipts", SQL_0015),
    Migration("0016_galgame_archive_staging", SQL_0016),
    Migration("0017_visual_upload_staging", SQL_0017),
    Migration("0018_visual_conversation_scopes", SQL_0018),
    Migration("0019_visual_archive_staging", SQL_0019),
    Migration("0020_retire_visual_conversations", RETIRE_VISUAL_DIALOGUE),
)
