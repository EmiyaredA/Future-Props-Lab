"""Rebuild the owned audio reference after transferring and verifying its original."""

from studio.contracts.audio_annotation.migration import PINS_DATASET, PINS_PATH, AnnotationPinPage

from .migration_transfer import DatasetTransfer, run_cli

PINS = DatasetTransfer(PINS_DATASET, PINS_PATH, AnnotationPinPage, "id", page_size=1)

if __name__ == "__main__":
    run_cli(__doc__, (PINS,))
