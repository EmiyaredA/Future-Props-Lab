"""Verify inference task relationships and relay exact Models original bytes."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.model_service.storage.migration_originals import (
    ATTACHMENTS,
    INFERENCE,
    PLAYGROUND_TASKS,
    Original,
    receipt_for,
)
from studio.apps.model_service.transport.migration_originals_http import (
    RELATIONSHIPS,
    TEST_RELATIONSHIPS,
)
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback

ORIGINALS = TypeAdapter(list[Original])


def manifest(client, address, owner, headers, *, complete, scope=INFERENCE):
    response = client.get(
        f"{address}{scope.prefix}/{owner}", headers=headers, params={"complete": complete}
    )
    response.raise_for_status()
    originals = ORIGINALS.validate_json(response.content)
    keys = [(item.kind, item.id) for item in originals]
    if keys != sorted(set(keys)) or any(item.kind not in scope.kinds for item in originals):
        raise ValueError("模型文件清单标识或顺序无效")
    return originals


def transfer_originals(client, plan, source, target, scope):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    for address in (source, target):
        client.get(address + scope.prefix, headers=headers).raise_for_status()
    digest = hashlib.sha256()
    count = size = 0
    for owner in sorted(plan.owner_ids):
        expected = manifest(client, source, owner, headers, complete=True, scope=scope)
        current = manifest(client, target, owner, headers, complete=False, scope=scope)
        if set(current) - set(expected):
            raise ValueError("目标模型原件与源快照冲突")
        for item in expected:
            path = f"{scope.prefix}/{owner}/{item.kind}/{item.id}/{item.size}/{item.sha256}"
            with client.stream("GET", source + path, headers=headers) as original:
                original.raise_for_status()
                result = client.put(target + path, headers=headers, content=original.iter_bytes())
            result.raise_for_status()
            receipt = receipt_for(plan, owner, item, scope)
            if BatchReceipt.model_validate_json(result.content) != receipt:
                raise ValueError("模型原件导入回执不一致")
            digest.update(receipt.batch_id.bytes)
            digest.update(bytes.fromhex(receipt.sha256))
            count += 1
            size += item.size
        if (
            manifest(client, target, owner, headers, complete=True, scope=scope) != expected
            or manifest(client, source, owner, headers, complete=True, scope=scope) != expected
        ):
            raise ValueError("模型原件读回与源快照不符")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": scope.dataset,
        "record_count": count,
        "byte_count": size,
        "sha256": digest.hexdigest(),
    }


def relationship_count(client, plan, source, target, route):
    source, target = loopback(source), loopback(target)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    relations = []
    for address in (source, target):
        response = client.get(address + route, headers=headers)
        response.raise_for_status()
        relations.append(response.json())
    if relations[0] != relations[1]:
        raise ValueError("模型任务输入关联验收计数不符")
    return relations[0]["record_count"]


def transfer_inference_originals(client, plan, source, target):
    count = relationship_count(client, plan, source, target, RELATIONSHIPS)
    return {
        **transfer_originals(client, plan, source, target, INFERENCE),
        "task_count": count,
    }


def transfer_model_originals(client, plan, source, target):
    count = relationship_count(client, plan, source, target, TEST_RELATIONSHIPS)
    return {
        "inference": transfer_inference_originals(client, plan, source, target),
        "test_attachments": transfer_originals(client, plan, source, target, ATTACHMENTS),
        "test_tasks": {
            **transfer_originals(client, plan, source, target, PLAYGROUND_TASKS),
            "generation_task_count": count,
        },
    }
