"""Transfer Motion and Video project history after Assets originals have been verified."""

import argparse
import json
from pathlib import Path

import httpx

from fpl_assets.migration_blobs import BLOBS
from fpl_assets.migration_editing_scopes import DATASET, PREFIX, ProjectScopePage
from fpl_motion.migration_application import PREFIX as MOTION_PREFIX
from fpl_motion.migration_records import DATASETS as MOTION_DATASETS
from fpl_runtime.migration_batches import MigrationPlan
from fpl_video.migration_application import PREFIX as VIDEO_PREFIX
from fpl_video.migration_records import DATASETS as VIDEO_DATASETS

from .migrate_assets import manifest
from .migration_transfer import DatasetTransfer, loopback, transfer


def datasets(prefix, entries):
    return tuple(
        DatasetTransfer(
            item.name, f"{prefix}/{item.suffix}", item.page, item.key, page_size=item.page_size
        )
        for item in entries
    )


MOTION = datasets(MOTION_PREFIX, MOTION_DATASETS)
VIDEO = datasets(VIDEO_PREFIX, VIDEO_DATASETS)
ASSET_SCOPES = DatasetTransfer(DATASET, PREFIX, ProjectScopePage, "id")


def verify_originals(client, plan, source, target):
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    for address in (source, target):
        client.get(address + BLOBS, headers=headers).raise_for_status()
    for owner in sorted(plan.owner_ids):
        if manifest(client, source, owner, headers, complete=True) != manifest(
            client, target, owner, headers, complete=True
        ):
            raise ValueError("剪辑与特效项目原件迁移未核验")


def transfer_history(client, plan, source, target, spec):
    reports = [transfer(client, plan, source, target, item) for item in spec]
    if reports[0]["record_count"] != reports[1]["record_count"]:
        raise ValueError("历史项目与文稿记录数不一致")
    return reports


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    for service in ("motion", "video", "assets"):
        parser.add_argument(f"--{service}-source", required=True, type=loopback)
        parser.add_argument(f"--{service}-target", required=True, type=loopback)
    options = parser.parse_args()
    addresses = {value for key, value in vars(options).items() if key != "plan"}
    if len(addresses) != 6:
        parser.error("每个维护进程需要独立的回环地址")
    try:
        plan = MigrationPlan.read(options.plan)
    except (OSError, ValueError):
        parser.error("迁移计划无法读取或格式无效")
    try:
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            verify_originals(client, plan, options.assets_source, options.assets_target)
            motion = transfer_history(
                client, plan, options.motion_source, options.motion_target, MOTION
            )
            video = transfer_history(
                client, plan, options.video_source, options.video_target, VIDEO
            )
            scope = transfer(
                client, plan, options.assets_source, options.assets_target, ASSET_SCOPES
            )
            if scope["record_count"] != motion[0]["record_count"] + video[0]["record_count"]:
                raise ValueError("素材范围与剪辑及特效项目数量不一致")
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except ValueError:
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps([*motion, *video, scope], sort_keys=True))


if __name__ == "__main__":
    main()
