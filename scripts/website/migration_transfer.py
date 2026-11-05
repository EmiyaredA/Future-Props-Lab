"""Relay and verify one service dataset at a time over authenticated loopback HTTP."""

import argparse
import hashlib
import json
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid5

import httpx

from studio.contracts.management.migration_batches import (
    MAX_RECORDS,
    BatchReceipt,
    MigrationPage,
    MigrationPlan,
)


@dataclass(frozen=True)
class DatasetTransfer:
    name: str
    prefix: str
    page: type[MigrationPage]
    key_field: str
    platform: bool = False
    page_size: int = MAX_RECORDS


def project_datasets(prefix, entries):
    return tuple(
        DatasetTransfer(
            item.name, f"{prefix}/{item.suffix}", item.page, item.key, page_size=item.page_size
        )
        for item in entries
    )


def loopback(value):
    try:
        address = urlsplit(value)
        if (
            address.scheme == "http"
            and address.hostname in {"127.0.0.1", "::1"}
            and address.port
            and address.username is None
            and address.password is None
            and address.path in {"", "/"}
            and not address.query
            and not address.fragment
        ):
            return f"http://{address.netloc}"
    except ValueError:
        pass
    raise argparse.ArgumentTypeError("迁移地址须为带端口的 HTTP 回环地址")


def inventory(client, address, headers, dataset):
    response = client.get(f"{address}{dataset.prefix}/inventory", headers=headers)
    response.raise_for_status()
    return response.json()["record_count"]


def pages(client, address, headers, plan, owner, dataset):
    cursor = None
    while True:
        response = client.get(
            f"{address}{dataset.prefix}/{owner}",
            headers=headers,
            params={} if cursor is None else {"after": cursor},
        )
        response.raise_for_status()
        page = dataset.page.model_validate(response.json())
        batch = page.batch
        keys = [getattr(record, dataset.key_field) for record in batch.records]
        if (
            batch.run_id != plan.run_id
            or batch.source_revision != plan.source_revision
            or batch.source_database_sha256 != plan.source_database_sha256
            or batch.dataset != dataset.name
            or batch.owner_id != owner
            or batch.batch_id != uuid5(plan.run_id, f"{dataset.name}/{owner}/{cursor or ''}")
            or batch.digest != page.sha256
            or len(keys) > dataset.page_size
            or keys != sorted(set(keys))
            or (keys and keys[0] <= (cursor or ""))
            or (
                page.next_cursor is not None
                and (len(keys) != dataset.page_size or page.next_cursor != keys[-1])
            )
        ):
            raise ValueError("迁移页的来源、摘要或分页校验失败")
        yield page
        cursor = page.next_cursor
        if cursor is None:
            return


def transfer(client, plan, source, target, dataset):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = inventory(client, source, headers, dataset)
    if inventory(client, target, headers, dataset) > before:
        raise ValueError("迁移目标记录数超过源快照")
    owners = (plan.run_id,) if dataset.platform else sorted(plan.owner_ids)
    for owner in owners:
        for page in pages(client, source, headers, plan, owner, dataset):
            batch = page.batch
            response = client.post(
                f"{target}{dataset.prefix}/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": page.sha256},
                json=batch.model_dump(mode="json"),
            )
            response.raise_for_status()
            expected = BatchReceipt(
                run_id=batch.run_id,
                owner_id=owner,
                batch_id=batch.batch_id,
                dataset=dataset.name,
                sha256=page.sha256,
                record_count=len(batch.records),
            )
            if BatchReceipt.model_validate(response.json()) != expected:
                raise ValueError("目标导入回执不匹配")

    digest = hashlib.sha256()
    count = 0
    for owner in owners:
        for original, imported in zip(
            pages(client, source, headers, plan, owner, dataset),
            pages(client, target, headers, plan, owner, dataset),
            strict=True,
        ):
            if original.sha256 != imported.sha256 or original.next_cursor != imported.next_cursor:
                raise ValueError("目标账号记录与源快照不匹配")
            digest.update(bytes.fromhex(original.sha256))
            count += len(original.batch.records)
    if count != before or inventory(client, target, headers, dataset) != before:
        raise ValueError("目标导入记录数不匹配")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": dataset.name,
        "record_count": count,
        "sha256": digest.hexdigest(),
    }


def run_cli(description, datasets, *, followup=None):
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument("--plan", required=True, type=Path)
    parser.add_argument("--source", required=True, type=loopback)
    parser.add_argument("--target", required=True, type=loopback)
    options = parser.parse_args()
    try:
        plan = MigrationPlan.read(options.plan)
    except (OSError, ValueError):
        parser.error("迁移计划无法读取或格式无效")
    try:
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            report = [
                transfer(client, plan, options.source, options.target, dataset)
                for dataset in datasets
            ]
            if followup is not None:
                report.append(followup(client, plan, options.source, options.target))
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except ValueError:
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps(report[0] if len(report) == 1 else report, sort_keys=True))
