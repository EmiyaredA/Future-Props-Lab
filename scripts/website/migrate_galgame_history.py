"""Relay Galgame Story history and exact historical pins after the Assets transfer."""

import argparse
import json
from pathlib import Path

import httpx

from studio.apps.galgame_workshop.storage.migration_records import DATASETS, OPERATIONS
from studio.assembly.independent.galgame_workshop.maintenance import PREFIX
from studio.contracts.galgame_workshop.galgame_migration import (
    PINS_DATASET,
    PINS_PATH,
    StoryPinPage,
)
from studio.contracts.management.migration_batches import MigrationPlan
from studio.runtime.database.edit_receipt_migration import SUFFIX

from .migrate_assets import verify_originals
from .migration_transfer import (
    DatasetTransfer,
    http_failure,
    inventory,
    loopback,
    project_datasets,
    transfer,
)

RECORDS = (
    *project_datasets(PREFIX, DATASETS),
    DatasetTransfer(OPERATIONS.name, f"{PREFIX}/{SUFFIX}", OPERATIONS.page, "id", page_size=1),
)
PINS = DatasetTransfer(PINS_DATASET, PINS_PATH, StoryPinPage, "id", page_size=1)


def migrate(client, plan, galgame_source, galgame_target, assets_source, assets_target):
    verify_originals(client, plan, assets_source, assets_target)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    inventory(client, galgame_source, headers, PINS)
    results = [transfer(client, plan, galgame_source, galgame_target, item) for item in RECORDS]
    pins = transfer(client, plan, galgame_source, assets_target, PINS)
    if any(report["record_count"] != pins["record_count"] for report in results[:2]):
        raise ValueError("Galgame 项目、Story 与素材范围记录数不一致")
    return [*results, pins]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    addresses = ("galgame_source", "galgame_target", "assets_source", "assets_target")
    for address in addresses:
        parser.add_argument("--" + address.replace("_", "-"), required=True, type=loopback)
    options = parser.parse_args()
    peers = [getattr(options, address) for address in addresses]
    if len(set(peers)) != len(peers):
        parser.error("每个维护进程需要独立的回环地址")
    try:
        plan = MigrationPlan.read(options.plan)
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            report = migrate(client, plan, *peers)
    except httpx.HTTPStatusError as exc:
        parser.exit(1, http_failure(exc.response))
    except (OSError, ValueError, httpx.RequestError):
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
