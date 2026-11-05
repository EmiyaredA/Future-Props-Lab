from studio.apps.integrations.storage.migrations.versions.v0001 import SQL as SQL_0001
from studio.apps.integrations.storage.migrations.versions.v0002 import SQL as SQL_0002
from studio.apps.integrations.storage.migrations.versions.v0003 import SQL as SQL_0003
from studio.apps.integrations.storage.migrations.versions.v0004 import SQL as SQL_0004
from studio.apps.integrations.storage.migrations.versions.v0006 import SQL as SQL_0006
from studio.apps.integrations.storage.migrations.versions.v0007 import SQL as SQL_0007
from studio.apps.integrations.storage.migrations.versions.v0008 import SQL as SQL_0008
from studio.apps.integrations.storage.migrations.versions.v0009 import SQL as SQL_0009
from studio.apps.integrations.storage.migrations.versions.v0010 import SQL as SQL_0010
from studio.apps.integrations.storage.migrations.versions.v0011 import SQL as SQL_0011
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_integration_catalogues", SQL_0001),
    Migration("0002_validation_attempts", SQL_0002),
    Migration("0003_external_execution_receipts", SQL_0003),
    Migration("0004_external_closures", SQL_0004),
    Migration("0006_demo_installations", SQL_0006),
    Migration("0007_native_mcp", SQL_0007),
    Migration("0008_creative_receipts", SQL_0008),
    Migration("0009_creative_cancellations", SQL_0009),
    Migration("0010_amadeus_tool_calls", SQL_0010),
    Migration("0011_import_receipts", SQL_0011),
)
