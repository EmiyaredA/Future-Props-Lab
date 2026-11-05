"""Relay Visual Canvas history and exact historical pins after the Assets transfer."""

import argparse
import json
from pathlib import Path

import httpx

from studio.apps.visual_workshop.storage.migration_records import DATASETS, OPERATIONS
from studio.assembly.independent.visual_workshop.maintenance import PREFIX
from studio.contracts.management.migration_batches import MigrationPlan
from studio.contracts.visual_workshop.visual_migration import (
    ACCEPTANCE_PINS_DATASET,
    ACCEPTANCE_PINS_PATH,
    CANVAS_PINS_DATASET,
    CANVAS_PINS_PATH,
    CONVERSATION_PINS_DATASET,
    CONVERSATION_PINS_PATH,
    AcceptancePinPage,
    CanvasPinPage,
    ConversationPinPage,
)
from studio.runtime.database.edit_receipt_migration import SUFFIX

from .migrate_assets import verify_originals
from .migration_transfer import DatasetTransfer, loopback, project_datasets, transfer

RECORDS = (
    *project_datasets(PREFIX, DATASETS),
    DatasetTransfer(OPERATIONS.name, f"{PREFIX}/{SUFFIX}", OPERATIONS.page, "id", page_size=1),
)
PINS = DatasetTransfer(CANVAS_PINS_DATASET, CANVAS_PINS_PATH, CanvasPinPage, "id", page_size=1)
ACCEPTANCE_PINS = DatasetTransfer(
    ACCEPTANCE_PINS_DATASET, ACCEPTANCE_PINS_PATH, AcceptancePinPage, "id", page_size=1
)
CONVERSATION_PINS = DatasetTransfer(
    CONVERSATION_PINS_DATASET, CONVERSATION_PINS_PATH, ConversationPinPage, "id", page_size=1
)


def migrate(client, plan, visual_source, visual_target, assets_source, assets_target):
    verify_originals(client, plan, assets_source, assets_target)
    results = [transfer(client, plan, visual_source, visual_target, item) for item in RECORDS]
    pins = transfer(client, plan, visual_source, assets_target, PINS)
    if any(report["record_count"] != pins["record_count"] for report in results[:2]):
        raise ValueError("Visual 项目、Canvas 与素材范围记录数不一致")
    conversation_pins = transfer(client, plan, visual_source, assets_target, CONVERSATION_PINS)
    conversations = next(
        row for row in results if row["dataset"] == "visual.assistant-conversations"
    )
    if conversations["record_count"] != conversation_pins["record_count"]:
        raise ValueError("Visual 对话与附件范围记录数不一致")
    acceptance_pins = transfer(client, plan, visual_source, assets_target, ACCEPTANCE_PINS)
    if acceptance_pins["record_count"] != pins["record_count"]:
        raise ValueError("Visual 工程与验收素材范围记录数不一致")
    return [*results, pins, conversation_pins, acceptance_pins]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True, type=Path)
    addresses = ("visual_source", "visual_target", "assets_source", "assets_target")
    for address in addresses:
        parser.add_argument("--" + address.replace("_", "-"), required=True, type=loopback)
    options = parser.parse_args()
    peers = [getattr(options, address) for address in addresses]
    if len(set(peers)) != len(peers):
        parser.error("每个维护进程需要独立的回环地址")
    try:
        plan = MigrationPlan.read(options.plan)
        with httpx.Client(trust_env=False, timeout=30, follow_redirects=False) as client:
            report = migrate(client, plan, *peers)
    except httpx.HTTPStatusError as exc:
        parser.exit(1, f"迁移请求失败（HTTP {exc.response.status_code}）\n")
    except (OSError, ValueError, httpx.RequestError):
        parser.exit(1, "迁移校验失败，保留已持久化的批次回执\n")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
