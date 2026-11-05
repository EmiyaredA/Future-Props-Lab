"""Transfer integrations, credential ciphertext and check history through sealed maintenance."""

from studio.assembly.independent.integrations.maintenance import DATASETS, PREFIX

from .migration_transfer import project_datasets, run_cli

if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS))
