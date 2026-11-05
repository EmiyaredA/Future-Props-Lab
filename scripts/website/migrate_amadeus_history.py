"""Transfer Amadeus dialogue history, continuation links and owned originals."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.amadeus.storage.migration_history import DATASETS, LINKS
from studio.apps.amadeus.storage.migration_originals import DATASET, Original, file_receipt
from studio.apps.amadeus.storage.migration_originals import PREFIX as ORIGINALS
from studio.assembly.independent.amadeus.maintenance import PREFIX, RELATIONSHIPS
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback, project_datasets, run_cli

MANIFEST = TypeAdapter(list[Original])


def verify_relationships(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    before = client.get(source + RELATIONSHIPS, headers=headers)
    after = client.get(target + RELATIONSHIPS, headers=headers)
    before.raise_for_status()
    after.raise_for_status()
    if before.json() != after.json():
        raise ValueError("Amadeus 运行及事件关系与源快照不一致")
    return {"dataset": "amadeus.relationships", **after.json()}


def transfer_originals(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    proof = hashlib.sha256()
    count = total = 0

    def inventory(address, route, *, complete):
        response = client.get(
            address + route + "/inventory", params={"complete": complete}, headers=headers
        )
        response.raise_for_status()
        files = MANIFEST.validate_json(response.content)
        keys = [(file.conversation_id, file.path) for file in files]
        if keys != sorted(set(keys)):
            raise ValueError("Amadeus 原件清单存在重复路径")
        return files

    for address in (source, target):
        client.get(address + ORIGINALS, headers=headers).raise_for_status()
    for owner in sorted(plan.owner_ids):
        route = f"{ORIGINALS}/{owner}"
        expected = inventory(source, route, complete=True)
        if set(inventory(target, route, complete=False)) - set(expected):
            raise ValueError("目标 Amadeus 原件与源快照不一致")
        for file in expected:
            params = file.model_dump()
            with client.stream(
                "GET", source + route + "/file", params=params, headers=headers
            ) as original:
                original.raise_for_status()
                response = client.put(
                    target + route + "/file",
                    params=params,
                    headers=headers,
                    content=original.iter_bytes(),
                )
            response.raise_for_status()
            receipt = file_receipt(plan, owner, file)
            if BatchReceipt.model_validate_json(response.content) != receipt:
                raise ValueError("Amadeus 原件回执不匹配")
            proof.update(receipt.batch_id.bytes)
            proof.update(bytes.fromhex(receipt.sha256))
            count += 1
            total += file.size
        if (
            inventory(source, route, complete=True) != expected
            or inventory(target, route, complete=True) != expected
        ):
            raise ValueError("Amadeus 原件迁移读回不一致")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "byte_count": total,
        "sha256": proof.hexdigest(),
    }


def verify_and_transfer_originals(client, plan, source, target):
    history = verify_relationships(client, plan, source, target)
    originals = transfer_originals(client, plan, source, target)
    return {**originals, "relationships": history}


if __name__ == "__main__":
    run_cli(
        __doc__,
        project_datasets(PREFIX, (*DATASETS, LINKS)),
        followup=verify_and_transfer_originals,
    )
