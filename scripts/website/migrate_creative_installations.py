"""Rebuild Integrations links after transferring both Creative and Integrations originals."""

import argparse
import json
from pathlib import Path

import httpx

from studio.contracts.creative_workshop.installation_migration import (
    DATASET,
    PAGE_SIZE,
    PREFIX,
    RESOURCE_PRESENCE,
    InstalledPartsPage,
    LegacyResourcePresence,
)
from studio.contracts.management.migration_batches import MigrationPlan

from .migration_transfer import DatasetTransfer, loopback, transfer

INSTALLATIONS = DatasetTransfer(DATASET, PREFIX, InstalledPartsPage, "id", page_size=PAGE_SIZE)


def bind_original_resources(client, plan, legacy):
    legacy = loopback(legacy)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}

    def pages(owner, source_pages):
        for page in source_pages:
            records = []
            for record in page.batch.records:
                resource = record.result
                if resource.state != "pending_setup":
                    address = (
                        f"{legacy}{RESOURCE_PRESENCE}/{owner}"
                        f"/{resource.kind}/{resource.resource_id}"
                    )
                    response = client.get(address, headers=headers)
                    response.raise_for_status()
                    proof = LegacyResourcePresence.model_validate_json(response.content)
                    if (
                        proof.run_id != plan.run_id
                        or proof.source_database_sha256 != plan.source_database_sha256
                        or proof.owner_id != owner
                        or proof.kind != resource.kind
                        or proof.resource_id != resource.resource_id
                    ):
                        raise ValueError("安装资源证明与源快照不一致")
                    record = record.model_copy(update={"resource_present": proof.present})
                records.append(record)
            batch = page.batch.model_copy(update={"records": tuple(records)})
            yield page.model_copy(update={"batch": batch, "sha256": batch.digest})

    return pages


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--source", required=True, type=loopback, help="已迁入的 Creative")
    parser.add_argument("--target", required=True, type=loopback, help="已迁入的 Integrations")
    parser.add_argument(
        "--legacy", required=True, type=loopback, help="封存快照的 Integrations 导出"
    )
    options = parser.parse_args()
    if len({options.source, options.target, options.legacy}) != 3:
        parser.error("迁移需要三个独立维护入口")
    try:
        plan = MigrationPlan.read(options.plan)
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            result = transfer(
                client,
                plan,
                options.source,
                options.target,
                INSTALLATIONS,
                source_pages=bind_original_resources(client, plan, options.legacy),
            )
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except (OSError, ValueError):
        parser.exit(1, "迁移来源或资源校验失败，保留已持久化的批次回执\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
