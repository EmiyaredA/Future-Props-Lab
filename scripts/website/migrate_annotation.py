"""Transfer Annotation projects, documents, waveforms and edit receipts."""

from studio.assembly.independent.audio_annotation.maintenance import COVERAGE, DATASETS
from studio.contracts.audio_annotation.migration import PREFIX

from .migration_transfer import project_datasets, run_cli


def verify_projects(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = client.get(source + COVERAGE, headers=headers)
    after = client.get(target + COVERAGE, headers=headers)
    before.raise_for_status()
    after.raise_for_status()
    if before.json() != after.json():
        raise ValueError("录音标注项目和子记录覆盖不一致")
    return {"dataset": "annotation.project-coverage", **after.json()}


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=verify_projects)
