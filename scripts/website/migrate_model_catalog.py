"""Transfer model catalog, encrypted providers, account policy and call history."""

from studio.apps.model_service.catalog_migration import DATASETS
from studio.apps.model_service.settings_migration import SETTINGS
from studio.apps.model_service.storage.migration_history import DATASETS as HISTORY_DATASETS
from studio.assembly.independent.model_service.maintenance import PREFIX

from .migrate_model_inference import transfer_model_originals
from .migration_transfer import DatasetTransfer, project_datasets, run_cli

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

HISTORY = project_datasets(PREFIX, HISTORY_DATASETS)

if __name__ == "__main__":
    run_cli(__doc__, CATALOG + POLICIES + HISTORY, followup=transfer_model_originals)
