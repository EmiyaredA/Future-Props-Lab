"""Rebuild Thought file references and verify community and sync originals."""

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

DOCUMENT_TRANSFERS = {dataset.name: dataset for dataset in project_datasets(PREFIX, DOCUMENTS)}


def verify_related_originals(client, plan, source, target, dataset, *, report, error):
    source, target = loopback(source), loopback(target)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    count = 0
    digest = hashlib.sha256()
    for owner in sorted(plan.owner_ids):
        files = None
        for page in pages(client, source, headers, plan, owner, DOCUMENT_TRANSFERS[dataset]):
            if page.batch.records and files is None:
                files = {
                    item.id: item.sha256
                    for item in manifest(client, target, owner, headers, complete=True)
                }
            for record in page.batch.records:
                if record.asset_id not in files:
                    raise ValueError(error)
                evidence = [
                    str(owner),
                    record.model_dump(mode="json", exclude={"cursor"}),
                    files[record.asset_id],
                ]
                digest.update(
                    json.dumps(evidence, sort_keys=True, separators=(",", ":")).encode() + b"\n"
                )
                count += 1
    return {"dataset": report, "record_count": count, "sha256": digest.hexdigest()}


def verify_community_uploads(client, plan, source, target):
    return verify_related_originals(
        client,
        plan,
        source,
        target,
        "thought.community-uploads",
        report="thought.community-upload-originals",
        error="社区上传的素材原件缺失或归属不符",
    )


def verify_sync_originals(client, plan, source, target):
    return verify_related_originals(
        client,
        plan,
        source,
        target,
        "thought.sync-assets",
        report="thought.sync-originals",
        error="外部同步的素材原件缺失或归属不符",
    )


def verify_originals(client, plan, source, target):
    return {
        "dataset": "thought.related-originals",
        "community": verify_community_uploads(client, plan, source, target),
        "sync": verify_sync_originals(client, plan, source, target),
    }


if __name__ == "__main__":
    run_cli(__doc__, DATASETS, followup=verify_originals)
