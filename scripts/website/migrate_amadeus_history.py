"""Transfer Amadeus dialogue records before restoring their continuation links."""

from studio.apps.amadeus.storage.migration_history import DATASETS, LINKS
from studio.assembly.independent.amadeus.maintenance import PREFIX, RELATIONSHIPS

from .migration_transfer import project_datasets, run_cli


def verify_relationships(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = client.get(source + RELATIONSHIPS, headers=headers)
    after = client.get(target + RELATIONSHIPS, headers=headers)
    before.raise_for_status()
    after.raise_for_status()
    if before.json() != after.json():
        raise ValueError("Amadeus 运行及事件关系与源快照不一致")
    return {"dataset": "amadeus.relationships", **after.json()}


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, (*DATASETS, LINKS)), followup=verify_relationships)
