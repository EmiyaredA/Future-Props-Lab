"""Transfer Remote desktop preference revisions through loopback HTTP."""

from fpl_remote.migration_application import PREFIX
from fpl_remote.preference_migration import DATASET, PreferencePage

from .migration_transfer import DatasetTransfer, run_cli

PREFERENCES = DatasetTransfer(DATASET, PREFIX, PreferencePage, "owner_user_id")

if __name__ == "__main__":
    run_cli(__doc__, (PREFERENCES,))
