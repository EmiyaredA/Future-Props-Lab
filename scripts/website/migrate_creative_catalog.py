"""Transfer Creative catalogue records, covers and frozen Skill trees."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.creative_workshop.storage.migration_catalog import DATASETS
from studio.apps.creative_workshop.storage.migration_originals import DATASET, Original, receipt
from studio.apps.creative_workshop.storage.migration_originals import PREFIX as ORIGINALS
from studio.assembly.independent.creative_workshop.maintenance import PREFIX, RELATIONSHIPS
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback, project_datasets, run_cli

MANIFEST = TypeAdapter(list[Original])


def transfer_creative_originals(client, plan, source, target):
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
        paths = [file.path for file in files]
        if paths != sorted(set(paths)):
            raise ValueError("创作文件清单存在重复路径")
        return files

    for address in (source, target):
        client.get(address + RELATIONSHIPS, headers=headers).raise_for_status()
    for owner in sorted(plan.owner_ids):
        route = f"{ORIGINALS}/{owner}"
        expected = inventory(source, route, complete=True)
        current = inventory(target, route, complete=False)
        if set(current) - set(expected):
            raise ValueError("目标创作文件与源快照冲突")
        for file in expected:
            params = file.model_dump()
            with client.stream(
                "GET", source + route + "/file", params=params, headers=headers
            ) as response:
                response.raise_for_status()
                saved = client.put(
                    target + route + "/file",
                    params=params,
                    headers=headers,
                    content=response.iter_bytes(),
                )
            saved.raise_for_status()
            accepted = receipt(plan, owner, file)
            if BatchReceipt.model_validate_json(saved.content) != accepted:
                raise ValueError("创作文件回执不符")
            proof.update(accepted.batch_id.bytes)
            proof.update(bytes.fromhex(accepted.sha256))
            count += 1
            total += file.size
        if (
            inventory(source, route, complete=True) != expected
            or inventory(target, route, complete=True) != expected
        ):
            raise ValueError("创作文件迁移读回与源快照不一致")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "byte_count": total,
        "sha256": proof.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=transfer_creative_originals)
