"""Independent Assets migration sequence."""

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
)
