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
)
