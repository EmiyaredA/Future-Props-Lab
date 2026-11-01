"""Historical migration fixtures stop before the account ownership transition."""

from unittest.mock import patch

from db.migrations import apply_migrations as apply_current
from db.migrations import runner
from db.migrations.registry import MIGRATIONS as CURRENT_MIGRATIONS

MIGRATIONS = CURRENT_MIGRATIONS[:-1]


def apply_migrations(path):
    migrations = tuple(m for m in runner.MIGRATIONS if m.migration_id != "0116_account_ownership")
    with (
        patch.object(runner, "MIGRATIONS", migrations),
        patch.object(runner, "LATEST_MIGRATION_ID", migrations[-1].migration_id),
    ):
        return apply_current(path)


LATEST_MIGRATION_ID = MIGRATIONS[-1].migration_id


def check_migrations(path):
    migrations = tuple(m for m in runner.MIGRATIONS if m.migration_id != "0116_account_ownership")
    with (
        patch.object(runner, "MIGRATIONS", migrations),
        patch.object(runner, "LATEST_MIGRATION_ID", migrations[-1].migration_id),
    ):
        return runner.check_migrations(path)
