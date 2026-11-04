"""Transfer accounts before browser sessions and Management API keys."""

from fpl_identity.credential_migration import DATASETS
from fpl_identity.migration_application import PREFIX

from .migration_transfer import DatasetTransfer, run_cli

CREDENTIALS = tuple(
    DatasetTransfer(dataset.name, f"{PREFIX}/{dataset.path}", dataset.page, "id")
    for dataset in DATASETS
)

if __name__ == "__main__":
    run_cli(__doc__, CREDENTIALS)
