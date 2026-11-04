"""Transfer Director project and motion records before streaming owned originals."""

import hashlib

from pydantic import TypeAdapter

from fpl_director.migration_application import PREFIX
from fpl_director.migration_files import DATASET, FILES, DirectorFile, receipt_for
from fpl_director.migration_records import DATASETS, PAGE_SIZE
from fpl_runtime.migration_batches import BatchReceipt

from .migration_transfer import DatasetTransfer, loopback, run_cli

DIRECTOR_RECORDS = tuple(
    DatasetTransfer(
        dataset.name,
        f"{PREFIX}/{dataset.name.split('.')[1]}",
        dataset.page,
        "id",
        page_size=PAGE_SIZE,
    )
    for dataset in DATASETS
)
MANIFEST = TypeAdapter(list[DirectorFile])


def manifest(client, address, owner, headers, *, complete):
    result = client.get(f"{address}{FILES}/{owner}", headers=headers, params={"complete": complete})
    result.raise_for_status()
    return MANIFEST.validate_json(result.content)


def transfer_director_files(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    for address in (source, target):
        client.get(address + FILES, headers=headers).raise_for_status()
    digest = hashlib.sha256()
    record_count = byte_count = 0
    for owner in sorted(plan.owner_ids):
        expected = manifest(client, source, owner, headers, complete=True)
        current = manifest(client, target, owner, headers, complete=False)
        if set(current) - set(expected):
            raise ValueError("目标导演台存在未登记的文件")
        for file in expected:
            path = f"{FILES}/{owner}/{file.scope}/{file.sha256}"
            with client.stream("GET", source + path, headers=headers) as download:
                download.raise_for_status()
                result = client.put(target + path, content=download.iter_bytes(), headers=headers)
            result.raise_for_status()
            receipt = receipt_for(plan, owner, file)
            if BatchReceipt.model_validate_json(result.content) != receipt:
                raise ValueError("导演台文件导入回执不匹配")
            digest.update(bytes.fromhex(receipt.sha256))
            record_count += 1
            byte_count += file.size
        if (
            manifest(client, source, owner, headers, complete=True) != expected
            or manifest(client, target, owner, headers, complete=True) != expected
        ):
            raise ValueError("导演台文件清单与源快照不一致")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": record_count,
        "byte_count": byte_count,
        "sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, DIRECTOR_RECORDS, followup=transfer_director_files)
