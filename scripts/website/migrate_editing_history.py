"""Transfer Motion and Video project history after Assets originals have been verified."""

import argparse
import hashlib
import json
from pathlib import Path

import httpx

from fpl_assets.migration_editing_scopes import DATASET, PREFIX, ProjectScopePage
from fpl_assets.migration_video_outputs import DATASET as OUTPUT_DATASET
from fpl_assets.migration_video_outputs import PREFIX as OUTPUT_PREFIX
from fpl_assets.migration_video_outputs import LegacyOutputPage
from fpl_motion.migration_application import PREFIX as MOTION_PREFIX
from fpl_motion.migration_records import DATASETS as MOTION_DATASETS
from fpl_runtime.editing_artifacts import (
    MOTION_DATASET,
    VIDEO_DATASET,
    MotionRenderPage,
    VideoDerivativePage,
    file_receipt,
)
from fpl_runtime.editing_artifacts import (
    MOTION_PREFIX as MOTION_ARTIFACT_PREFIX,
)
from fpl_runtime.editing_artifacts import (
    VIDEO_PREFIX as VIDEO_ARTIFACT_PREFIX,
)
from fpl_runtime.migration_batches import BatchReceipt, MigrationPlan
from fpl_video.migration_application import PREFIX as VIDEO_PREFIX
from fpl_video.migration_records import DATASETS as VIDEO_DATASETS

from .migrate_assets import verify_originals as verify_originals
from .migration_transfer import DatasetTransfer, loopback, pages, project_datasets, transfer

MOTION = project_datasets(MOTION_PREFIX, MOTION_DATASETS)
VIDEO = project_datasets(VIDEO_PREFIX, VIDEO_DATASETS)
ASSET_SCOPES = DatasetTransfer(DATASET, PREFIX, ProjectScopePage, "id")
VIDEO_OUTPUTS = DatasetTransfer(OUTPUT_DATASET, OUTPUT_PREFIX, LegacyOutputPage, "id", page_size=1)
MOTION_OUTPUTS = DatasetTransfer(
    MOTION_DATASET, MOTION_ARTIFACT_PREFIX, MotionRenderPage, "id", page_size=1
)
VIDEO_VARIANTS = DatasetTransfer(
    VIDEO_DATASET, VIDEO_ARTIFACT_PREFIX, VideoDerivativePage, "id", page_size=1
)


def transfer_history(client, plan, source, target, spec):
    reports = [transfer(client, plan, source, target, item) for item in spec]
    if reports[0]["record_count"] != reports[1]["record_count"]:
        raise ValueError("历史项目与文稿记录数不一致")
    return reports


def transfer_artifacts(client, plan, source, target, dataset):
    inventory = transfer(client, plan, source, target, dataset)
    headers = {"X-Fpl-Migration-Token": plan.token.get_secret_value()}
    summary = hashlib.sha256()
    file_count = byte_count = 0
    for owner in sorted(plan.owner_ids):
        for page in pages(client, source, headers, plan, owner, dataset):
            for record in page.batch.records:
                for file in record.files:
                    path = f"{dataset.prefix}/files/{owner}/{record.id}/{file.key}/{file.sha256}"
                    receipt = file_receipt(plan, owner, dataset.name, record.id, file)
                    existing = client.head(target + path, headers=headers)
                    if existing.status_code != 200:
                        with client.stream("GET", source + path, headers=headers) as original:
                            original.raise_for_status()
                            response = client.put(
                                target + path, headers=headers, content=original.iter_bytes()
                            )
                        response.raise_for_status()
                        if BatchReceipt.model_validate_json(response.content) != receipt:
                            raise ValueError("历史渲染文件回执不一致")
                        existing = client.head(target + path, headers=headers)
                    existing.raise_for_status()
                    if existing.headers.get(
                        "X-Fpl-Artifact-SHA256"
                    ) != file.sha256 or existing.headers.get("Content-Length") != str(file.size):
                        raise ValueError("历史渲染文件读回不一致")
                    summary.update(bytes.fromhex(receipt.sha256))
                    file_count += 1
                    byte_count += file.size
    return inventory, {
        "run_id": str(plan.run_id),
        "source_revision": plan.source_revision,
        "dataset": dataset.name + "-files",
        "record_count": file_count,
        "byte_count": byte_count,
        "sha256": summary.hexdigest(),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    for service in ("motion", "video", "assets"):
        parser.add_argument(f"--{service}-source", required=True, type=loopback)
        parser.add_argument(f"--{service}-target", required=True, type=loopback)
    parser.add_argument("--rendering-target", required=True, type=loopback)
    options = parser.parse_args()
    addresses = {value for key, value in vars(options).items() if key != "plan"}
    if len(addresses) != 7:
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
            video_outputs = transfer(
                client, plan, options.assets_source, options.assets_target, VIDEO_OUTPUTS
            )
            motion_files = transfer_artifacts(
                client, plan, options.motion_source, options.rendering_target, MOTION_OUTPUTS
            )
            video_files = transfer_artifacts(
                client, plan, options.video_source, options.rendering_target, VIDEO_VARIANTS
            )
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except httpx.RequestError:
        parser.exit(1, "迁移维护服务连接失败\n")
    except ValueError:
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(
        json.dumps(
            [*motion, *video, scope, video_outputs, *motion_files, *video_files], sort_keys=True
        )
    )


if __name__ == "__main__":
    main()
