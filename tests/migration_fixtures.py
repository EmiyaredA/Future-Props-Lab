"""Historical migration fixtures stop before the account ownership transition."""

from unittest.mock import patch

from db.migrations import apply_migrations as apply_current
from db.migrations import runner
from db.migrations.registry import MIGRATIONS as CURRENT_MIGRATIONS


def legacy_prefix(migrations):
    index = next(
        (i for i, item in enumerate(migrations) if item.migration_id == "0116_account_ownership"),
        len(migrations),
    )
    return migrations[:index]


MIGRATIONS = legacy_prefix(CURRENT_MIGRATIONS)


def apply_migrations(path):
    migrations = legacy_prefix(runner.MIGRATIONS)
    with (
        patch.object(runner, "MIGRATIONS", migrations),
        patch.object(runner, "LATEST_MIGRATION_ID", migrations[-1].migration_id),
    ):
        return apply_current(path)


LATEST_MIGRATION_ID = MIGRATIONS[-1].migration_id


def check_migrations(path):
    migrations = legacy_prefix(runner.MIGRATIONS)
    with (
        patch.object(runner, "MIGRATIONS", migrations),
        patch.object(runner, "LATEST_MIGRATION_ID", migrations[-1].migration_id),
    ):
        return runner.check_migrations(path)
