"""Transfer suppliers, encrypted providers, model entries and catalog revisions."""

from fpl_models.catalog_migration import DATASETS
from fpl_models.migration_application import PREFIX
from fpl_models.settings_migration import SETTINGS

from .migration_transfer import DatasetTransfer, run_cli

CATALOG = tuple(
    DatasetTransfer(
        dataset.name, f"{PREFIX}/{dataset.name.split('.')[1]}", dataset.page, dataset.key
    )
    for dataset in DATASETS
)

POLICIES = tuple(
    DatasetTransfer(
        dataset.name,
        f"{PREFIX}/{dataset.name.split('.')[1]}",
        dataset.page,
        "key",
        platform=dataset.platform,
    )
    for dataset in SETTINGS
)

if __name__ == "__main__":
    run_cli(__doc__, CATALOG + POLICIES)
