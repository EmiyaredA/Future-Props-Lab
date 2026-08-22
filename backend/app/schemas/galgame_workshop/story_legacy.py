from __future__ import annotations

import hashlib
from typing import Any

from app.schemas.galgame_workshop.base_core import CHARACTER_THEME_PALETTE

LEGACY_STORY_VERSIONS = {None, "1.0", "1.1", "1.2", "1.3"}


def migrate_legacy_story_dict(value: Any) -> Any:
    """Convert a supported Story 1.0–1.3 dictionary to the 1.4 input shape."""
    if not isinstance(value, dict):
        return value
    migrated = dict(value)
    source_version = migrated.get("schemaVersion")
    if source_version in LEGACY_STORY_VERSIONS:
        migrated["schemaVersion"] = "1.4"
    chapters = [dict(chapter) for chapter in migrated.get("chapters", [])]
    for chapter in chapters:
        chapter.setdefault("disabled", False)
    migrated["chapters"] = chapters
    if not migrated.get("entryChapterId") and chapters:
        first = min(chapters, key=lambda chapter: chapter.get("order", 1))
        migrated["entryChapterId"] = first.get("id")
    migrated.setdefault("characterAttributeTemplates", [])
    characters = [dict(character) for character in migrated.get("characters", [])]
    for index, character in enumerate(characters):
        character.setdefault(
            "themeColor",
            CHARACTER_THEME_PALETTE[index % len(CHARACTER_THEME_PALETTE)],
        )
        legacy_avatar = dict(character.get("dialogueAvatar") or {})
        legacy_crop = legacy_avatar.pop("crop", None)
        character["dialogueAvatar"] = legacy_avatar
        expressions = [dict(expression) for expression in character.get("expressions", [])]
        for expression in expressions:
            expression.setdefault("renderMode", "staticImage")
        if legacy_crop is not None:
            for expression in expressions:
                expression.setdefault(
                    "dialogueAvatar",
                    {"source": "portrait", "crop": legacy_crop},
                )
        character["expressions"] = expressions
    migrated["characters"] = characters
    settings = dict(migrated.get("settings") or {})
    character_stage = dict(settings.get("characterStage") or {})
    legacy_scale = character_stage.pop("defaultScale", None)
    if legacy_scale is not None:
        character_stage.setdefault("legacyDefaultScale", legacy_scale)
    character_stage.setdefault("defaultHeightPercent", 100)
    if "positionPresets" not in character_stage:
        has_legacy_positions = any(
            key in character_stage for key in ("positions", "anchorX", "anchorY")
        )
        legacy_positions = dict(character_stage.pop("positions", {}) or {})
        legacy_y = character_stage.pop("anchorY", 100 if has_legacy_positions else 50)
        character_stage.pop("anchorX", None)
        position_defaults = (
            ("position-outer-left", "极左", None, 12),
            ("position-left", "左", "left", 25),
            ("position-center-left", "中左", "centerLeft", 37.5),
            ("position-center", "中", "center", 50),
            ("position-center-right", "中右", "centerRight", 62.5),
            ("position-right", "右", "right", 75),
            ("position-outer-right", "极右", None, 88),
        )
        character_stage["positionPresets"] = [
            {
                "id": preset_id,
                "name": name,
                "x": legacy_positions.get(key, default_x) if key else default_x,
                "y": legacy_y,
                **({"builtinKey": key} if key else {}),
            }
            for preset_id, name, key, default_x in position_defaults
        ]
    character_stage.setdefault("defaultPositionId", "position-center")
    character_stage.setdefault("anchor", "center")
    settings["characterStage"] = character_stage
    migrated["settings"] = settings

    assets = [dict(asset) for asset in migrated.get("assets", [])]
    for asset in assets:
        if asset.get("role") == "sceneBackground":
            asset["role"] = "sceneLayer"
    migrated["assets"] = assets

    migrated.setdefault("sceneGroups", [])
    if source_version in {None, "1.0", "1.1"}:
        used_scene_ids = {
            str(scene.get("id")) for scene in migrated.get("scenes", []) if scene.get("id")
        }
        split_scene_ids: dict[tuple[str, str], str] = {}
        normalized_scenes: list[dict[str, Any]] = []
        for raw_scene in migrated.get("scenes", []):
            scene = dict(raw_scene)
            backgrounds = [dict(item) for item in scene.pop("backgrounds", [])]
            default_background_id = scene.pop("defaultBackgroundId", None)
            if not backgrounds:
                scene.setdefault("layers", [])
                normalized_scenes.append(scene)
                continue
            default_background = next(
                (item for item in backgrounds if item.get("id") == default_background_id),
                backgrounds[0],
            )
            ordered = [default_background] + [
                item for item in backgrounds if item is not default_background
            ]
            for item_index, background in enumerate(ordered):
                scene_id = str(scene.get("id", "scene"))
                background_id = str(background.get("id", f"layer-{item_index + 1}"))
                if item_index == 0:
                    target_scene_id = scene_id
                else:
                    digest = hashlib.sha1(f"{scene_id}:{background_id}".encode()).hexdigest()[:10]
                    prefix = f"{scene_id}-{background_id}"[:53].rstrip("-")
                    target_scene_id = f"{prefix}-{digest}"
                    if target_scene_id in used_scene_ids:
                        target_scene_id = f"{scene_id[:52].rstrip('-')}-{digest}"
                    used_scene_ids.add(target_scene_id)
                split_scene_ids[(scene_id, background_id)] = target_scene_id
                split_scene = dict(scene)
                split_scene["id"] = target_scene_id
                if item_index:
                    suffix = str(background.get("label") or background_id)
                    split_scene["name"] = f"{scene.get('name', scene_id)} · {suffix}"[:120]
                split_scene["layers"] = [
                    {
                        "id": background_id,
                        "name": str(background.get("label") or background_id),
                        "assetId": background.get("assetId"),
                        "distance": 1,
                        "offsetX": 0,
                        "offsetY": 0,
                    }
                ]
                normalized_scenes.append(split_scene)
        migrated["scenes"] = normalized_scenes
        for chapter in migrated.get("chapters", []):
            for fragment in chapter.get("fragments", []):
                for block in fragment.get("blocks", []):
                    if block.get("type") != "scene":
                        continue
                    scene_id = str(block.get("sceneId", ""))
                    background_id = block.pop("backgroundId", None)
                    if background_id is not None:
                        block["sceneId"] = split_scene_ids.get(
                            (scene_id, str(background_id)), scene_id
                        )
    return migrated
