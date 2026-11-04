"""Copy Identity's avatar bytes after the matching account rows have been verified."""

import hashlib

from fpl_identity.avatar_migration import AVATAR_PATH, DIGEST_HEADER, AvatarReceipt


def transfer_avatars(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}

    def inventory(address):
        response = client.get(f"{address}{AVATAR_PATH}/inventory", headers=headers)
        response.raise_for_status()
        return response.json()["record_count"]

    before = inventory(source)
    if inventory(target) > before:
        raise ValueError("目标头像文件数超过源快照")
    count, size = 0, 0
    digest = hashlib.sha256()
    for owner in sorted(plan.owner_ids):
        path = f"{AVATAR_PATH}/{owner}"
        original = client.get(source + path, headers=headers)
        original.raise_for_status()
        if original.status_code == 200:
            data = original.content
            sha256 = hashlib.sha256(data).hexdigest()
            if sha256 != original.headers.get(DIGEST_HEADER):
                raise ValueError("源头像文件摘要不匹配")
            result = client.put(
                target + path,
                headers={
                    **headers,
                    "Content-Type": original.headers["Content-Type"],
                    DIGEST_HEADER: sha256,
                },
                content=data,
            )
            result.raise_for_status()
            if AvatarReceipt.model_validate(result.json()) != AvatarReceipt(
                owner_id=owner, sha256=sha256, byte_size=len(data)
            ):
                raise ValueError("头像文件回执不匹配")
            count += 1
            size += len(data)
            digest.update(owner.bytes)
            digest.update(bytes.fromhex(sha256))
        elif original.status_code != 204:
            raise ValueError("源头像响应无效")
        copied = client.get(target + path, headers=headers)
        copied.raise_for_status()
        if (
            copied.status_code != original.status_code
            or copied.headers.get(DIGEST_HEADER) != original.headers.get(DIGEST_HEADER)
            or copied.headers.get("Content-Type") != original.headers.get("Content-Type")
            or copied.content != original.content
        ):
            raise ValueError("目标头像文件与源快照不匹配")
    if count != before or inventory(target) != before or inventory(source) != before:
        raise ValueError("目标头像文件数不匹配")
    return {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": "identity.avatars",
        "record_count": count,
        "byte_count": size,
        "sha256": digest.hexdigest(),
    }
