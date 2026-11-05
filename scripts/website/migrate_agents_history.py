"""Transfer stopped Workbench history and verify its rebuilt text index."""

from fpl_agents.migration_application import DATASETS, PREFIX, SEARCH

from .migration_transfer import project_datasets, run_cli


def verify_index(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    original = client.get(source + SEARCH, headers=headers)
    original.raise_for_status()
    imported = client.get(target + SEARCH, headers=headers)
    imported.raise_for_status()
    if original.json() != imported.json():
        raise ValueError("工作台搜索索引与历史记录不匹配")
    return {"dataset": "agents.search", **imported.json()}


def main():
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=verify_index)


if __name__ == "__main__":
    main()
