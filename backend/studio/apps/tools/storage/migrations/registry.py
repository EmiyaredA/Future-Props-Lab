"""Explicit Tools schema migration registry."""

from studio.apps.tools.storage.migrations.versions.v0001 import SQL
from studio.apps.tools.storage.migrations.versions.v0002 import SQL as NATIVE
from studio.apps.tools.storage.migrations.versions.v0003 import SQL as DOWNLOAD_ARTIFACTS
from studio.apps.tools.storage.migrations.versions.v0004 import SQL as NAVIGATION_IMPORTS
from studio.runtime.database.migrations import Migration

MIGRATIONS = (
    Migration("0001_tools_navigation", SQL),
    Migration("0002_tools_native_jobs", NATIVE),
    Migration("0003_tools_download_artifacts", DOWNLOAD_ARTIFACTS),
    Migration("0004_tools_navigation_imports", NAVIGATION_IMPORTS),
)
