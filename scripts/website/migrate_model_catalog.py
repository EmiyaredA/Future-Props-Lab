"""Transfer suppliers, encrypted providers, model entries and catalog revisions."""

from studio.apps.model_service.catalog_migration import DATASETS
from studio.apps.model_service.settings_migration import SETTINGS
from studio.assembly.independent.model_service.maintenance import PREFIX

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
