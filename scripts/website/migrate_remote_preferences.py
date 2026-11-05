"""Transfer Remote desktop preference revisions through loopback HTTP."""

from studio.apps.remote_desktop.preference_migration import DATASET, PreferencePage
from studio.assembly.independent.remote_desktop.maintenance import PREFIX

from .migration_transfer import DatasetTransfer, run_cli

PREFERENCES = DatasetTransfer(DATASET, PREFIX, PreferencePage, "owner_user_id")

if __name__ == "__main__":
    run_cli(__doc__, (PREFERENCES,))
