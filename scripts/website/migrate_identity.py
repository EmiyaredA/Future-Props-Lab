"""Transfer accounts, credentials, registration history, audit events and profile files."""

from fpl_identity.credential_migration import DATASETS
from fpl_identity.migration_application import PREFIX

from .migrate_identity_avatars import transfer_avatars
from .migration_transfer import DatasetTransfer, run_cli

CREDENTIALS = tuple(
    DatasetTransfer(
        dataset.name, f"{PREFIX}/{dataset.path}", dataset.page, dataset.key_field, dataset.platform
    )
    for dataset in DATASETS
)

if __name__ == "__main__":
    run_cli(__doc__, CREDENTIALS, followup=transfer_avatars)
