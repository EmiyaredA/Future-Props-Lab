from __future__ import annotations

import argparse
import json
from copy import deepcopy
from pathlib import Path
from typing import Any

import httpx

try:
    from scripts.galgame_performance_upgrade import (
        BACKUP_ROOT,
        CG_ASSETS,
        CG_EVENTS,
        DEFAULT_PROJECT_ID,
        DEFAULT_SOURCE_ROOT,
        ApiError,
        dialogue_signature,
        install_cgs,
        load_asset_map,
        project_path,
        request_json,
        target_fragment,
        timestamp,
        write_json,
    )
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from galgame_performance_upgrade import (  # type: ignore[no-redef]
        BACKUP_ROOT,
        CG_ASSETS,
        CG_EVENTS,
        DEFAULT_PROJECT_ID,
        DEFAULT_SOURCE_ROOT,
        ApiError,
        dialogue_signature,
        install_cgs,
        load_asset_map,
        project_path,
        request_json,
        target_fragment,
        timestamp,
        write_json,
    )
    from management_api import management_api_key  # type: ignore[no-redef]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="通过正式 API 仅更新受管 CG，保留现有对白、表情与其他演出",
    )
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    return parser.parse_args()


def is_managed_cg_block(block: dict[str, Any]) -> bool:
    block_id = str(block.get("id", ""))
    return (
        block.get("type") in {"showCg", "hideCg"} and block_id.startswith("runaway-cg-")
    ) or block_id.startswith("runaway-phone-camera-")


def preserved_blocks(fragment: dict[str, Any]) -> list[dict[str, Any]]:
    return [
        deepcopy(block) for block in fragment.get("blocks", []) if not is_managed_cg_block(block)
    ]


def apply_cgs(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        document = deepcopy(latest["document"])
        fragment_before = target_fragment(document)
        dialogue_before = dialogue_signature(fragment_before)
        blocks_before = preserved_blocks(fragment_before)
        characters_before = deepcopy(document.get("characters", []))
        backup_path = BACKUP_ROOT / f"{timestamp()}-cgs-only-before.json"
        write_json(backup_path, latest)

        install_cgs(document, mapping)
        fragment_after = target_fragment(document)
        if dialogue_signature(fragment_after) != dialogue_before:
            raise RuntimeError("CG 窄更新不得修改对白内容、说话者或时间")
        if preserved_blocks(fragment_after) != blocks_before:
            raise RuntimeError("CG 窄更新不得修改非 CG Block")
        if document.get("characters", []) != characters_before:
            raise RuntimeError("CG 窄更新不得修改角色或表情")

        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                print("故事 revision 已变化，重新读取并仅重算 CG", flush=True)
                continue
            raise

        audit_path = BACKUP_ROOT / f"{timestamp()}-cgs-only-apply-audit.json"
        write_json(
            audit_path,
            {
                "beforeRevision": latest["revision"],
                "savedRevision": saved["revision"],
                "beforeSnapshot": str(backup_path),
                "cgAssets": len(CG_ASSETS),
                "cgEvents": len(CG_EVENTS),
                "dialogueCount": len(dialogue_before),
                "preservedNonCgBlocks": len(blocks_before),
            },
        )
        print(
            json.dumps(
                {"savedRevision": saved["revision"], "audit": str(audit_path)},
                ensure_ascii=False,
            )
        )
        return saved
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def main() -> None:
    args = parse_args()
    mapping = load_asset_map(args.project_id, args.source_root)
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_api_key()}"},
        timeout=None,
    ) as client:
        apply_cgs(client, args.project_id, mapping)


if __name__ == "__main__":
    main()
