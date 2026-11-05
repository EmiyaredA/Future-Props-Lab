"""Rebuild Thought file references and verify the originals of community uploads."""

import hashlib
import json

from studio.assembly.independent.thought_workshop.maintenance import DATASETS as DOCUMENTS
from studio.assembly.independent.thought_workshop.maintenance import PREFIX
from studio.contracts.thought_workshop.migration import PIN_KINDS, ThoughtPinPage, pin_path

from .migrate_assets import manifest
from .migration_transfer import DatasetTransfer, loopback, pages, project_datasets, run_cli

DATASETS = tuple(
    DatasetTransfer(dataset, pin_path(dataset), ThoughtPinPage, "id", page_size=1)
    for dataset in PIN_KINDS
)

UPLOADS = next(
    dataset
    for dataset in project_datasets(PREFIX, DOCUMENTS)
    if dataset.name == "thought.community-uploads"
)


def verify_community_uploads(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    count = 0
    digest = hashlib.sha256()
    for owner in sorted(plan.owner_ids):
        files = None
        for page in pages(client, source, headers, plan, owner, UPLOADS):
            if page.batch.records and files is None:
                files = {
                    item.id: item.sha256
                    for item in manifest(client, target, owner, headers, complete=True)
                }
            for record in page.batch.records:
                if record.asset_id not in files:
                    raise ValueError("社区上传的素材原件缺失或归属不符")
                evidence = [
                    str(owner),
                    record.note_id,
                    record.asset_id,
                    record.user_id,
                    files[record.asset_id],
                ]
                digest.update(json.dumps(evidence, separators=(",", ":")).encode() + b"\n")
                count += 1
    return {
        "dataset": "thought.community-upload-originals",
        "record_count": count,
        "sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, DATASETS, followup=verify_community_uploads)
