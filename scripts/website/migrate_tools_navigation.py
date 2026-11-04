"""Relay a frozen Tools navigation dataset over authenticated loopback HTTP."""

import argparse
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid5

import httpx

from fpl_runtime.migration_batches import MAX_RECORDS, BatchReceipt, MigrationPlan
from fpl_tools.migration_application import PREFIX
from fpl_tools.navigation_migration import DATASET, NavigationPage


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


def inventory(client, address, headers):
    response = client.get(f"{address}{PREFIX}/inventory", headers=headers)
    response.raise_for_status()
    return response.json()["record_count"]


def pages(client, address, headers, plan, owner):
    cursor = None
    while True:
        response = client.get(
            f"{address}{PREFIX}/{owner}",
            headers=headers,
            params={} if cursor is None else {"after": cursor},
        )
        response.raise_for_status()
        page = NavigationPage.model_validate(response.json())
        batch = page.batch
        keys = [record.tool_id for record in batch.records]
        if (
            batch.run_id != plan.run_id
            or batch.source_revision != plan.source_revision
            or batch.source_database_sha256 != plan.source_database_sha256
            or batch.owner_id != owner
            or batch.batch_id != uuid5(plan.run_id, f"{DATASET}/{owner}/{cursor or ''}")
            or batch.digest != page.sha256
            or keys != sorted(set(keys))
            or (keys and keys[0] <= (cursor or ""))
            or (
                page.next_cursor is not None
                and (len(keys) != MAX_RECORDS or page.next_cursor != keys[-1])
            )
        ):
            raise ValueError("迁移页的来源、摘要或分页校验失败")
        yield page
        cursor = page.next_cursor
        if cursor is None:
            return


def transfer(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = inventory(client, source, headers)
    if inventory(client, target, headers) > before:
        raise ValueError("迁移目标记录数超过源快照")
    owners = sorted(plan.owner_ids)
    for owner in owners:
        for page in pages(client, source, headers, plan, owner):
            batch = page.batch
            response = client.post(
                f"{target}{PREFIX}/batches",
                headers={**headers, "X-Fpl-Migration-SHA256": page.sha256},
                json=batch.model_dump(mode="json"),
            )
            response.raise_for_status()
            expected = BatchReceipt(
                run_id=batch.run_id,
                owner_id=owner,
                batch_id=batch.batch_id,
                dataset=DATASET,
                sha256=page.sha256,
                record_count=len(batch.records),
            )
            if BatchReceipt.model_validate(response.json()) != expected:
                raise ValueError("目标导入回执不匹配")

    digest = hashlib.sha256()
    count = 0
    for owner in owners:
        for original, imported in zip(
            pages(client, source, headers, plan, owner),
            pages(client, target, headers, plan, owner),
            strict=True,
        ):
            if original.sha256 != imported.sha256 or original.next_cursor != imported.next_cursor:
                raise ValueError("目标账号记录与源快照不匹配")
            digest.update(bytes.fromhex(original.sha256))
            count += len(original.batch.records)
    if count != before or inventory(client, target, headers) != before:
        raise ValueError("目标导入记录数不匹配")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "sha256": digest.hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
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
            report = transfer(client, plan, options.source, options.target)
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except ValueError:
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
