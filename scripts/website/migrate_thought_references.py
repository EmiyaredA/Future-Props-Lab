"""Rebuild the four Thought reference sets after Assets has verified original files."""

from studio.contracts.thought_workshop.migration import PIN_KINDS, ThoughtPinPage, pin_path

from .migration_transfer import DatasetTransfer, run_cli

DATASETS = tuple(
    DatasetTransfer(dataset, pin_path(dataset), ThoughtPinPage, "id", page_size=1)
    for dataset in PIN_KINDS
)

if __name__ == "__main__":
    run_cli(__doc__, DATASETS)
