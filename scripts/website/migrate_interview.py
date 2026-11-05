"""Relay Interview history, exact original files and private batch receipts."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.interview_assistant.storage.migration_materials import DATASET, file_receipt
from studio.apps.interview_assistant.storage.migration_materials import PREFIX as MATERIALS
from studio.apps.interview_assistant.storage.migration_records import Material
from studio.assembly.independent.interview_assistant.maintenance import (
    DATASETS,
    PREFIX,
    RELATIONSHIPS,
)
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback, project_datasets, run_cli

MANIFEST = TypeAdapter(list[Material])


def transfer_materials(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    proof = hashlib.sha256()
    count = total = 0

    def relationships(address):
        response = client.get(address + RELATIONSHIPS, headers=headers)
        response.raise_for_status()
        return response.json()

    def inventory(address, route, *, complete):
        response = client.get(
            address + route + "/inventory", params={"complete": complete}, headers=headers
        )
        response.raise_for_status()
        files = MANIFEST.validate_json(response.content)
        ids = [file.id for file in files]
        if ids != sorted(set(ids)):
            raise ValueError("面试材料清单存在重复 ID")
        return files

    for address in (source, target):
        client.get(address + MATERIALS, headers=headers).raise_for_status()
    if relationships(source) != relationships(target):
        raise ValueError("面试场次与准备任务关系不一致")
    for owner in sorted(plan.owner_ids):
        route = f"{MATERIALS}/{owner}"
        expected = inventory(source, route, complete=True)
        if set(inventory(target, route, complete=False)) - set(expected):
            raise ValueError("目标面试材料与源快照不一致")
        for file in expected:
            path = f"{route}/{file.room_id}/{file.id}"
            with client.stream("GET", source + path, headers=headers) as original:
                original.raise_for_status()
                response = client.put(target + path, headers=headers, content=original.iter_bytes())
            response.raise_for_status()
            receipt = file_receipt(plan, owner, file)
            if BatchReceipt.model_validate_json(response.content) != receipt:
                raise ValueError("面试材料回执不匹配")
            proof.update(receipt.batch_id.bytes)
            proof.update(bytes.fromhex(receipt.sha256))
            count += 1
            total += file.size
        if (
            inventory(source, route, complete=True) != expected
            or inventory(target, route, complete=True) != expected
        ):
            raise ValueError("面试材料读回不一致")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "byte_count": total,
        "sha256": proof.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=transfer_materials)
