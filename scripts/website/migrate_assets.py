"""Transfer Assets folder records before files and verify the original bytes."""

import hashlib

import httpx
from pydantic import TypeAdapter

from studio.apps.asset_library.migration_blobs import BLOBS, DATASET, AssetBlob, receipt_for
from studio.apps.asset_library.storage.migration_records import DATASETS
from studio.assembly.independent.asset_library.maintenance import PREFIX
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import DatasetTransfer, loopback, request_stage, run_cli

ASSET_RECORDS = tuple(
    DatasetTransfer(
        dataset.name, f"{PREFIX}/{dataset.name.split('.')[1]}", dataset.page, dataset.key
    )
    for dataset in DATASETS
)
MANIFEST = TypeAdapter(list[AssetBlob])
# The maintenance endpoint hashes every owned original before sending its first byte.
MANIFEST_TIMEOUT = httpx.Timeout(30, read=180)
MANIFEST_RETRY = (httpx.ConnectError, httpx.ReadError, httpx.RemoteProtocolError)


def manifest(client, address, owner, headers, *, complete, peer):
    with request_stage(f"素材{peer}原件清单"):
        for attempt in range(2):
            try:
                response = client.get(
                    f"{address}{BLOBS}/{owner}",
                    headers=headers,
                    params={"complete": complete},
                    timeout=MANIFEST_TIMEOUT,
                )
            except MANIFEST_RETRY:
                if attempt:
                    raise
            else:
                break
    response.raise_for_status()
    result = MANIFEST.validate_json(response.content)
    ids = [item.id for item in result]
    if ids != sorted(set(ids)):
        raise ValueError("素材文件清单顺序或标识无效")
    return result


def check_endpoints(client, source, target, headers):
    for address, peer in ((source, "源端"), (target, "目标端")):
        with request_stage(f"素材{peer}维护入口"):
            client.get(address + BLOBS, headers=headers).raise_for_status()


def read_original(response):
    with request_stage("素材源端原件读取"):
        yield from response.iter_bytes()


def transfer_asset_blobs(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    check_endpoints(client, source, target, headers)
    digest = hashlib.sha256()
    count = size = 0
    for owner in sorted(plan.owner_ids):
        expected = manifest(client, source, owner, headers, complete=True, peer="源端")
        current = manifest(client, target, owner, headers, complete=False, peer="目标端")
        if set(current) - set(expected):
            raise ValueError("目标素材原件与源快照冲突")
        for item in expected:
            path = f"{BLOBS}/{owner}/{item.id}/{item.sha256}"
            with (
                request_stage("素材源端原件读取"),
                client.stream("GET", source + path, headers=headers) as original,
            ):
                original.raise_for_status()
                with request_stage("素材目标端写入或回执读取"):
                    result = client.put(
                        target + path, headers=headers, content=read_original(original)
                    )
            result.raise_for_status()
            receipt = receipt_for(plan, owner, item)
            if BatchReceipt.model_validate_json(result.content) != receipt:
                raise ValueError("素材原件导入回执不一致")
            digest.update(bytes.fromhex(receipt.sha256))
            count += 1
            size += item.size
        if (
            manifest(client, target, owner, headers, complete=True, peer="目标端") != expected
            or manifest(client, source, owner, headers, complete=True, peer="源端") != expected
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


def verify_originals(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    check_endpoints(client, source, target, headers)
    for owner in sorted(plan.owner_ids):
        if manifest(client, source, owner, headers, complete=True, peer="源端") != manifest(
            client, target, owner, headers, complete=True, peer="目标端"
        ):
            raise ValueError("素材原件迁移未核验")


if __name__ == "__main__":
    run_cli(__doc__, ASSET_RECORDS, followup=transfer_asset_blobs)
