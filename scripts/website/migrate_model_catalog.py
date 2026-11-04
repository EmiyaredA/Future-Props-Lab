"""Transfer suppliers, encrypted providers, model entries and catalog revisions."""

from fpl_models.catalog_migration import DATASETS
from fpl_models.migration_application import PREFIX

from .migration_transfer import DatasetTransfer, run_cli

CATALOG = tuple(
    DatasetTransfer(
        dataset.name, f"{PREFIX}/{dataset.name.split('.')[1]}", dataset.page, dataset.key
    )
    for dataset in DATASETS
)

if __name__ == "__main__":
    run_cli(__doc__, CATALOG)
