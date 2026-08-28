from __future__ import annotations

import argparse
import io
import json
import math
from collections import defaultdict
from copy import deepcopy
from typing import Any

import httpx
from PIL import Image

try:
    from scripts.demo.galgame_runaway.performance_upgrade import (
        BACKUP_ROOT,
        ApiError,
        dialogue_signature,
        project_path,
        request_json,
        target_fragment,
        timestamp,
        write_json,
    )
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from performance_upgrade import (  # type: ignore[no-redef]
        BACKUP_ROOT,
        ApiError,
        dialogue_signature,
        project_path,
        request_json,
        target_fragment,
        timestamp,
        write_json,
    )

    from management_api import management_api_key  # type: ignore[no-redef]


def _ground_transform(transform: dict[str, Any] | None) -> tuple[dict[str, Any], bool]:
    grounded = dict(transform or {})
    changed = grounded.get("y") != 100.0 or grounded.get("anchor") != "bottomCenter"
    grounded["y"] = 100.0
    grounded["anchor"] = "bottomCenter"
    return grounded, changed


def _ground_stage_settings(settings: dict[str, Any], stats: dict[str, int]) -> None:
    if settings.get("anchor") != "bottomCenter":
        settings["anchor"] = "bottomCenter"
        stats["stageAnchors"] += 1
    for preset in settings.get("positionPresets") or []:
        if preset.get("y") != 100.0:
            preset["y"] = 100.0
            stats["positionPresets"] += 1


def ground_document(document: dict[str, Any]) -> dict[str, int]:
    stats = defaultdict(int)
    settings = document.setdefault("settings", {})
    _ground_stage_settings(settings.setdefault("characterStage", {}), stats)
    for override in (settings.get("characterStageOverrides") or {}).values():
        _ground_stage_settings(override, stats)

    for chapter in document.get("chapters") or []:
        for fragment in chapter.get("fragments") or []:
            for block in fragment.get("blocks") or []:
                block_type = block.get("type")
                if block_type == "dialogue":
                    portrait = block.get("portrait")
                    if not isinstance(portrait, dict) or portrait.get("mode", "stage") not in {
                        "stage",
                        "soloLegacy",
                    }:
                        continue
                    portrait["transform"], changed = _ground_transform(portrait.get("transform"))
                    stats["dialoguePortraits"] += int(changed)
                elif block_type == "showCharacter":
                    block["transform"], changed = _ground_transform(block.get("transform"))
                    stats["showCharacterBlocks"] += int(changed)
                elif block_type == "setStageCast":
                    for member in block.get("members") or []:
                        member["transform"], changed = _ground_transform(member.get("transform"))
                        stats["stageCastMembers"] += int(changed)
    return dict(stats)


def placement_audit(document: dict[str, Any]) -> dict[str, Any]:
    checked = 0
    violations: list[dict[str, Any]] = []

    def check(
        kind: str,
        owner_id: str,
        transform: dict[str, Any] | None,
        *,
        require_anchor: bool = True,
    ) -> None:
        nonlocal checked
        checked += 1
        value = transform or {}
        if value.get("y") == 100.0 and (
            not require_anchor or value.get("anchor") == "bottomCenter"
        ):
            return
        violations.append(
            {
                "kind": kind,
                "id": owner_id,
                "y": value.get("y"),
                "anchor": value.get("anchor"),
            }
        )

    settings = document.get("settings") or {}
    stage_settings = [
        ("characterStage", settings.get("characterStage") or {}),
        *[
            (f"characterStageOverride:{character_id}", override)
            for character_id, override in (settings.get("characterStageOverrides") or {}).items()
        ],
    ]
    for setting_id, stage in stage_settings:
        check(setting_id, setting_id, {"y": 100.0, "anchor": stage.get("anchor")})
        for preset in stage.get("positionPresets") or []:
            check(
                "positionPreset",
                f"{setting_id}:{preset.get('id')}",
                preset,
                require_anchor=False,
            )

    for chapter in document.get("chapters") or []:
        for fragment in chapter.get("fragments") or []:
            for block in fragment.get("blocks") or []:
                block_type = block.get("type")
                if block_type == "dialogue":
                    portrait = block.get("portrait")
                    if isinstance(portrait, dict) and portrait.get("mode", "stage") in {
                        "stage",
                        "soloLegacy",
                    }:
                        check("dialogue", str(block.get("id")), portrait.get("transform"))
                elif block_type == "showCharacter":
                    check("showCharacter", str(block.get("id")), block.get("transform"))
                elif block_type == "setStageCast":
                    for member in block.get("members") or []:
                        check(
                            "stageCastMember",
                            f"{block.get('id')}:{member.get('characterId')}",
                            member.get("transform"),
                        )
    return {"checked": checked, "violationCount": len(violations), "violations": violations}


def _portrait_file_references(document: dict[str, Any]) -> dict[str, list[str]]:
    assets = {str(asset.get("id")): asset for asset in document.get("assets") or []}
    references: dict[str, list[str]] = defaultdict(list)

    def add(asset_id: str | None, label: str) -> None:
        asset = assets.get(str(asset_id))
        file_id = str((asset or {}).get("fileId") or "")
        if file_id:
            references[file_id].append(label)

    for character in document.get("characters") or []:
        character_name = str(character.get("name") or character.get("id") or "角色")
        for expression in character.get("expressions") or []:
            label = f"{character_name} · {expression.get('label') or expression.get('id')}"
            add(expression.get("assetId"), label)
            for frame in (expression.get("sequence") or {}).get("frames") or []:
                add(frame.get("assetId"), label)
        for skin in character.get("portraitSkins") or []:
            for override in skin.get("overrides") or []:
                add(
                    override.get("assetId"),
                    f"{character_name} · 皮肤 {skin.get('name') or skin.get('id')}",
                )
    return dict(references)


def _meaningful_alpha_bottom(image: Image.Image) -> int:
    rgba = image.convert("RGBA")
    alpha = rgba.getchannel("A")
    pixels = alpha.load()
    minimum_visible_pixels = max(1, math.ceil(rgba.width * 0.002))
    for y in range(rgba.height - 1, -1, -1):
        if sum(pixels[x, y] >= 8 for x in range(rgba.width)) >= minimum_visible_pixels:
            return y + 1
    return rgba.height


def portrait_asset_audit(client: httpx.Client, document: dict[str, Any]) -> dict[str, Any]:
    references = _portrait_file_references(document)
    items: list[dict[str, Any]] = []
    failed: list[dict[str, str]] = []
    for index, (file_id, labels) in enumerate(sorted(references.items()), start=1):
        try:
            response = client.get(f"/v1/files/{file_id}/content")
            response.raise_for_status()
            with Image.open(io.BytesIO(response.content)) as image:
                bottom = _meaningful_alpha_bottom(image)
                transparent_bottom = image.height - bottom
                items.append(
                    {
                        "fileId": file_id,
                        "width": image.width,
                        "height": image.height,
                        "transparentBottomPixels": transparent_bottom,
                        "transparentBottomPercent": round(
                            transparent_bottom / image.height * 100, 4
                        ),
                        "references": sorted(set(labels)),
                    }
                )
        except (httpx.HTTPError, OSError) as exc:
            failed.append({"fileId": file_id, "error": str(exc)})
        if index % 50 == 0:
            print(f"已检查 {index}/{len(references)} 张立绘资产", flush=True)
    return {
        "checked": len(items),
        "failedCount": len(failed),
        "failed": failed,
        "withTransparentBottom": sum(item["transparentBottomPixels"] > 0 for item in items),
        "maxTransparentBottomPercent": max(
            (item["transparentBottomPercent"] for item in items), default=0
        ),
        "items": items,
    }


def apply_grounding(client: httpx.Client, project_id: str) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        document = deepcopy(latest["document"])
        dialogue_before = dialogue_signature(target_fragment(document))
        characters_before = deepcopy(document.get("characters") or [])
        backup_path = BACKUP_ROOT / f"{timestamp()}-portrait-grounding-before.json"
        write_json(backup_path, latest)
        changed = ground_document(document)
        if dialogue_signature(target_fragment(document)) != dialogue_before:
            raise RuntimeError("立绘落地窄更新不得修改对白、说话者、表情或时间")
        if document.get("characters") != characters_before:
            raise RuntimeError("立绘落地窄更新不得修改角色与表情资产")
        audit = placement_audit(document)
        if audit["violationCount"]:
            raise RuntimeError(f"仍有未落地的舞台坐标：{audit['violations'][:5]}")
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                print("故事 revision 已变化，重新读取并仅重算立绘落地参数", flush=True)
                continue
            raise
        asset_audit = portrait_asset_audit(client, document)
        audit_path = BACKUP_ROOT / f"{timestamp()}-portrait-grounding-audit.json"
        report = {
            "beforeRevision": latest["revision"],
            "savedRevision": saved["revision"],
            "beforeSnapshot": str(backup_path),
            "changed": changed,
            "placements": audit,
            "portraitAssets": asset_audit,
        }
        write_json(audit_path, report)
        print(
            json.dumps(
                {
                    "savedRevision": saved["revision"],
                    "placementCount": audit["checked"],
                    "placementViolations": audit["violationCount"],
                    "portraitAssets": asset_audit["checked"],
                    "assetFailures": asset_audit["failedCount"],
                    "assetsWithTransparentBottom": asset_audit["withTransparentBottom"],
                    "audit": str(audit_path),
                },
                ensure_ascii=False,
            )
        )
        return saved
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="通过正式故事 API 将所有舞台立绘锚定到底边，并严格审计透明下边距",
    )
    parser.add_argument("--project-id", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_api_key()}"},
        timeout=None,
    ) as client:
        apply_grounding(client, args.project_id)


if __name__ == "__main__":
    main()
