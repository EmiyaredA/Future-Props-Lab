"""Transfer stopped Thought documents and verify rebuilt document relationships."""

from studio.assembly.independent.thought_workshop.maintenance import DATASETS, PREFIX, RELATIONSHIPS

from .migration_transfer import project_datasets, run_cli


def verify_relationships(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = client.get(source + RELATIONSHIPS, headers=headers)
    after = client.get(target + RELATIONSHIPS, headers=headers)
    before.raise_for_status()
    after.raise_for_status()
    if before.json() != after.json():
        raise ValueError("思绪工坊文档关系与源快照不匹配")
    return {"dataset": "thought.document-relationships", **after.json()}


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=verify_relationships)
