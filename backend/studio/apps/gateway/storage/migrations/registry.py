"""Gateway's explicit, ordered schema registry."""

from studio.apps.gateway.storage.migrations.versions.v0001 import SQL
from studio.runtime.database.migrations import Migration

MIGRATIONS = (Migration("0001_gateway", SQL),)
