"""Transfer Presentation documents and rebuild their verified Assets projections."""

import argparse
import json
from pathlib import Path

import httpx

from fpl_presentation.migration_application import PREFIX
from fpl_presentation.migration_operations import DATASET as OPERATIONS
from fpl_presentation.migration_operations import OperationPage
from fpl_presentation.migration_records import DATASETS
from fpl_runtime.migration_batches import MigrationPlan
from fpl_runtime.presentation_migration import REFERENCE_DATASETS, ProjectionPage

from .migration_transfer import DatasetTransfer, loopback, transfer

PRESENTATION_RECORDS = (
    *(
        DatasetTransfer(
            dataset.name,
            f"{PREFIX}/{dataset.name.split('.')[1]}",
            dataset.page,
            "id",
            page_size=1,
        )
        for dataset in DATASETS
    ),
    DatasetTransfer(OPERATIONS, PREFIX + "/operation-receipts", OperationPage, "id", page_size=1),
)
PRESENTATION_REFERENCES = tuple(
    DatasetTransfer(name, f"{PREFIX}/{name.split('.')[1]}", ProjectionPage, "id", page_size=1)
    for name in REFERENCE_DATASETS
)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--source", required=True, type=loopback)
    parser.add_argument("--target", required=True, type=loopback)
    parser.add_argument("--assets-target", required=True, type=loopback)
    options = parser.parse_args()
    if len({options.source, options.target, options.assets_target}) != 3:
        parser.error("三个维护入口必须分别使用不同地址")
    try:
        plan = MigrationPlan.read(options.plan)
    except (OSError, ValueError):
        parser.error("迁移计划无法读取或格式无效")
    try:
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            records = [
                transfer(client, plan, options.source, options.target, dataset)
                for dataset in PRESENTATION_RECORDS
            ]
            references = [
                transfer(client, plan, options.source, options.assets_target, dataset)
                for dataset in PRESENTATION_REFERENCES
            ]
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except ValueError:
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps(records + references, sort_keys=True))


if __name__ == "__main__":
    main()
