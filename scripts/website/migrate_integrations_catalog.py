"""Transfer integrations, credentials and Skill originals through sealed maintenance."""

import hashlib

from pydantic import TypeAdapter

from studio.apps.integrations.storage.migration_skills import VERSIONS
from studio.assembly.independent.integrations.maintenance import DATASETS, PREFIX
from studio.contracts.integrations.skill_migration import DATASET, SkillFile, file_receipt
from studio.contracts.integrations.skill_migration import PREFIX as ORIGINALS
from studio.contracts.management.migration_batches import BatchReceipt

from .migration_transfer import loopback, pages, project_datasets, run_cli

MANIFEST = TypeAdapter(list[SkillFile])
VERSION_TRANSFER = project_datasets(PREFIX, (VERSIONS,))[0]


def manifest(client, address, route, headers, *, complete):
    response = client.get(
        address + route + "/inventory", headers=headers, params={"complete": complete}
    )
    response.raise_for_status()
    result = MANIFEST.validate_json(response.content)
    paths = [file.path for file in result]
    if paths != sorted(set(paths)):
        raise ValueError("Skill 文件清单顺序或路径无效")
    return result


def transfer_skill_originals(client, plan, source, target):
    source, target = loopback(source), loopback(target)
    if source == target:
        raise ValueError("源和目标维护地址必须不同")
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    digest = hashlib.sha256()
    count = total = 0
    for address in (source, target):
        client.get(address + ORIGINALS, headers=headers).raise_for_status()
    for owner in sorted(plan.owner_ids):
        owner_route = f"{ORIGINALS}/{owner}"
        client.get(source + owner_route + "/inventory", headers=headers).raise_for_status()
        for page in pages(client, source, headers, plan, owner, VERSION_TRANSFER):
            for version in page.batch.records:
                route = f"{owner_route}/{version.skill_id}/{version.version}"
                expected = manifest(client, source, route, headers, complete=True)
                current = manifest(client, target, route, headers, complete=False)
                if set(current) - set(expected):
                    raise ValueError("目标 Skill 原件与源快照冲突")
                for file in expected:
                    params = file.model_dump()
                    with client.stream(
                        "GET", source + route + "/file", headers=headers, params=params
                    ) as original:
                        original.raise_for_status()
                        response = client.put(
                            target + route + "/file",
                            headers=headers,
                            params=params,
                            content=original.iter_bytes(),
                        )
                    response.raise_for_status()
                    receipt = file_receipt(plan, owner, version.skill_id, version.version, file)
                    if BatchReceipt.model_validate_json(response.content) != receipt:
                        raise ValueError("Skill 文件导入回执不一致")
                    digest.update(receipt.batch_id.bytes)
                    digest.update(bytes.fromhex(receipt.sha256))
                    count += 1
                    total += file.size
                if (
                    manifest(client, target, route, headers, complete=True) != expected
                    or manifest(client, source, route, headers, complete=True) != expected
                ):
                    raise ValueError("Skill 文件读回与源快照不符")
        client.get(target + owner_route + "/inventory", headers=headers).raise_for_status()
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": DATASET,
        "record_count": count,
        "byte_count": total,
        "sha256": digest.hexdigest(),
    }


if __name__ == "__main__":
    run_cli(__doc__, project_datasets(PREFIX, DATASETS), followup=transfer_skill_originals)
