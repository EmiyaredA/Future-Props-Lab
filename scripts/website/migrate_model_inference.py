"""Verify inference task relationships and relay exact original bytes."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.model_service.storage.migration_inference_files import (
    DATASET,
    PREFIX,
    Original,
    receipt_for,
)
from studio.apps.model_service.transport.migration_inference_http import RELATIONSHIPS
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback

ORIGINALS = TypeAdapter(list[Original])


def manifest(client, address, owner, headers, *, complete):
    response = client.get(
        f"{address}{PREFIX}/{owner}", headers=headers, params={"complete": complete}
    )
    response.raise_for_status()
    originals = ORIGINALS.validate_json(response.content)
    keys = [(item.kind, item.id) for item in originals]
    if keys != sorted(set(keys)):
        raise ValueError("推理文件清单标识或顺序无效")
    return originals


def transfer_inference_originals(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    relations = []
    for address in (source, target):
        response = client.get(address + RELATIONSHIPS, headers=headers)
        response.raise_for_status()
        relations.append(response.json())
        client.get(address + PREFIX, headers=headers).raise_for_status()
    if relations[0] != relations[1]:
        raise ValueError("推理输入关联验收计数不符")
    digest = hashlib.sha256()
    count = size = 0
    for owner in sorted(plan.owner_ids):
        expected = manifest(client, source, owner, headers, complete=True)
        current = manifest(client, target, owner, headers, complete=False)
        if set(current) - set(expected):
            raise ValueError("目标推理原件与源快照冲突")
        for item in expected:
            path = f"{PREFIX}/{owner}/{item.kind}/{item.id}/{item.size}/{item.sha256}"
            with client.stream("GET", source + path, headers=headers) as original:
                original.raise_for_status()
                result = client.put(target + path, headers=headers, content=original.iter_bytes())
            result.raise_for_status()
            receipt = receipt_for(plan, owner, item)
            if BatchReceipt.model_validate_json(result.content) != receipt:
                raise ValueError("推理原件导入回执不一致")
            digest.update(receipt.batch_id.bytes)
            digest.update(bytes.fromhex(receipt.sha256))
            count += 1
            size += item.size
        if (
            manifest(client, target, owner, headers, complete=True) != expected
            or manifest(client, source, owner, headers, complete=True) != expected
        ):
            raise ValueError("推理原件读回与源快照不符")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "task_count": relations[0]["record_count"],
        "byte_count": size,
        "sha256": digest.hexdigest(),
    }
