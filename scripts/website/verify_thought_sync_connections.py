"""Verify Thought bindings against the migrated Integrations catalogue."""

import hashlib
import json

from studio.apps.integrations.storage.catalog_migration import DATASETS
from studio.assembly.independent.integrations.maintenance import PREFIX

from .migrate_thought_references import DOCUMENT_TRANSFERS
from .migration_transfer import loopback, pages, project_datasets, run_cli

CONNECTIONS = next(
    dataset
    for dataset in project_datasets(PREFIX, DATASETS)
    if dataset.name == "integrations.external-connections"
)
RELATIONSHIPS = ("thought.sync-bindings", "thought.sync-tasks")


def verify_connections(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    digest = hashlib.sha256()
    count = 0
    for owner in sorted(plan.owner_ids):
        available = None
        for dataset in RELATIONSHIPS:
            for page in pages(client, source, headers, plan, owner, DOCUMENT_TRANSFERS[dataset]):
                for record in page.batch.records:
                    if dataset == "thought.sync-tasks" and record.status != "needs_review":
                        continue
                    if available is None:
                        available = {
                            entry.id
                            for listing in pages(client, target, headers, plan, owner, CONNECTIONS)
                            for entry in listing.batch.records
                        }
                    if record.connection_id not in available:
                        raise ValueError("外部同步的集成连接缺失或归属不符")
                    evidence = [str(owner), dataset, record.id, record.connection_id]
                    digest.update(json.dumps(evidence, separators=(",", ":")).encode() + b"\n")
                    count += 1
    return {
        "dataset": "thought.sync-connections",
        "record_count": count,
        "sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, (), followup=verify_connections)
