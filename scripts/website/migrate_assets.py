"""Transfer Assets folder records before files and verify the original bytes."""

import hashlib

from pydantic import TypeAdapter

from fpl_assets.migration_application import PREFIX
from fpl_assets.migration_blobs import BLOBS, DATASET, AssetBlob, receipt_for
from fpl_assets.migration_records import DATASETS
from fpl_runtime.migration_batches import BatchReceipt

from .migration_transfer import DatasetTransfer, loopback, run_cli

ASSET_RECORDS = tuple(
    DatasetTransfer(
        dataset.name, f"{PREFIX}/{dataset.name.split('.')[1]}", dataset.page, dataset.key
    )
    for dataset in DATASETS
)
MANIFEST = TypeAdapter(list[AssetBlob])


def manifest(client, address, owner, headers, *, complete):
    response = client.get(
        f"{address}{BLOBS}/{owner}", headers=headers, params={"complete": complete}
    )
    response.raise_for_status()
    result = MANIFEST.validate_json(response.content)
    ids = [item.id for item in result]
    if ids != sorted(set(ids)):
        raise ValueError("素材文件清单顺序或标识无效")
    return result


def transfer_asset_blobs(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    for address in (source, target):
        client.get(address + BLOBS, headers=headers).raise_for_status()
    digest = hashlib.sha256()
    count = size = 0
    for owner in sorted(plan.owner_ids):
        expected = manifest(client, source, owner, headers, complete=True)
        current = manifest(client, target, owner, headers, complete=False)
        if set(current) - set(expected):
            raise ValueError("目标素材原件与源快照冲突")
        for item in expected:
            path = f"{BLOBS}/{owner}/{item.id}/{item.sha256}"
            with client.stream("GET", source + path, headers=headers) as original:
                original.raise_for_status()
                result = client.put(target + path, headers=headers, content=original.iter_bytes())
            result.raise_for_status()
            receipt = receipt_for(plan, owner, item)
            if BatchReceipt.model_validate_json(result.content) != receipt:
                raise ValueError("素材原件导入回执不一致")
            digest.update(bytes.fromhex(receipt.sha256))
            count += 1
            size += item.size
        if (
            manifest(client, target, owner, headers, complete=True) != expected
            or manifest(client, source, owner, headers, complete=True) != expected
        ):
            raise ValueError("素材原件读回与源快照不符")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "byte_count": size,
        "sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, ASSET_RECORDS, followup=transfer_asset_blobs)
