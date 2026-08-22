from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECT_ID = "63ac832d-bff3-4053-9c9f-f55c9dafc52a"
DEFAULT_SOURCE_ROOT = Path("/Users/tonghao/Projects/steins-gate-video/assets/games/steins_gate_0")
BACKUP_ROOT = REPO_ROOT / ".runtime" / "galgame-import-backups"
MAP_PATH = BACKUP_ROOT / "sg0-performance-asset-map.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}

LIBRARY_GROUPS = (
    ("backgrounds/scenes", "scene"),
    ("cg/event", "cg"),
    ("backgrounds/inserts", "cg"),
)

CURATED_SCENES = (
    ("BG03A1", "实验室日常", 1.0),
    ("BG03A2", "实验室设备亮起", 0.9),
    ("BG03A3", "凌乱的实验室", 1.1),
    ("BG03A4", "实验室整理中", 0.95),
    ("BG03A5", "实验室另一角度", 1.15),
    ("BG11A2", "屋顶与时间机器", 1.0),
    ("BG11A3", "空旷屋顶", 1.12),
    ("BG11A7", "时间机器舱门开启", 0.92),
    ("BG11A8", "时间机器登舱梯", 1.05),
)

SCENE_BEATS = (
    (0, "BG03A1"),
    (28_000, "BG03A2"),
    (352_000, "BG11A3"),
    (365_000, "BG11A2"),
    (402_000, "BG11A7"),
    (650_000, "BG11A8"),
    (970_000, "BG03A1"),
    (1_188_000, "BG03A3"),
    (1_300_000, "BG03A4"),
    (1_364_000, "BG03A1"),
    (1_604_000, "BG11A7"),
    (1_680_000, "BG11A3"),
    (1_740_000, "BG03A5"),
)

SUZUHA_VARIANTS = {
    "calm": ("SUZ_HSD", "001"),
    "cheerful": ("SUZ_HSD", "002"),
    "serious": ("SUZ_HSD", "005"),
    "worried": ("SUZ_HSD", "007"),
    "strict": ("SUZ_HSE", "001"),
    "relieved": ("SUZ_HSE", "006"),
}


class ApiError(RuntimeError):
    def __init__(self, message: str, status_code: int) -> None:
        super().__init__(message)
        self.status_code = status_code


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="通过正式 API 导入 SG0 素材并重做目标广播剧演出")
    parser.add_argument("action", choices=("inspect", "upload", "apply", "audit", "all"))
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--source-root", type=Path, default=DEFAULT_SOURCE_ROOT)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    parser.add_argument("--batch-size", type=int, default=12)
    return parser.parse_args()


def timestamp() -> str:
    return datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    *,
    payload: dict[str, Any] | None = None,
    files: list[tuple[str, tuple[str, Any, str]]] | None = None,
    data: dict[str, str] | None = None,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload, files=files, data=data)
    if response.is_error:
        raise ApiError(
            f"API {method} {path} 返回 {response.status_code}: {response.text[:2000]}",
            response.status_code,
        )
    return response.json()


def project_path(project_id: str, suffix: str) -> str:
    return f"/v1/galgame-workshop/projects/{project_id}{suffix}"


def source_entries(source_root: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for relative_directory, category in LIBRARY_GROUPS:
        directory = source_root / relative_directory
        entries.extend(
            {
                "path": path,
                "relative": path.relative_to(source_root).as_posix(),
                "category": category,
            }
            for path in sorted(directory.iterdir())
            if path.is_file() and path.suffix.lower() in IMAGE_SUFFIXES
        )
    for pose, variant in SUZUHA_VARIANTS.values():
        for mouth in range(3):
            path = (
                source_root
                / "characters/amane_suzuha/sprites/variants"
                / pose
                / f"type_40_depends_{variant}_{mouth:03d}.png"
            )
            entries.append(
                {
                    "path": path,
                    "relative": path.relative_to(source_root).as_posix(),
                    "category": "character",
                }
            )
    missing = [str(item["path"]) for item in entries if not item["path"].is_file()]
    if missing:
        raise RuntimeError("缺少计划中的源素材：" + "、".join(missing[:10]))
    unique = {item["relative"]: item for item in entries}
    return [unique[key] for key in sorted(unique)]


def logical_library_entries(source_root: Path) -> list[dict[str, Any]]:
    return [
        item
        for item in source_entries(source_root)
        if any(item["relative"].startswith(f"{directory}/") for directory, _ in LIBRARY_GROUPS)
    ]


def load_asset_map(project_id: str, source_root: Path) -> dict[str, Any]:
    if MAP_PATH.is_file():
        current = json.loads(MAP_PATH.read_text(encoding="utf-8"))
        if current.get("projectId") == project_id:
            return current
    return {
        "version": 1,
        "projectId": project_id,
        "sourceRoot": str(source_root),
        "updatedAt": timestamp(),
        "items": {},
    }


def upload_assets(
    client: httpx.Client,
    project_id: str,
    source_root: Path,
    batch_size: int,
) -> dict[str, Any]:
    entries = source_entries(source_root)
    library_count = len(logical_library_entries(source_root))
    if library_count != 701:
        raise RuntimeError(f"原作背景/CG 应为 701 项，实际发现 {library_count} 项")
    request_json(
        client,
        "POST",
        project_path(project_id, "/assets/metadata-scan"),
    )
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    assets_by_id = {asset["id"]: asset for asset in listed}
    assets_by_checksum = {
        asset["checksumSha256"]: asset for asset in listed if asset.get("checksumSha256")
    }
    mapping = load_asset_map(project_id, source_root)
    mapping_items: dict[str, Any] = mapping["items"]
    pending_by_checksum: dict[str, dict[str, Any]] = {}

    for index, entry in enumerate(entries, start=1):
        checksum = sha256(entry["path"])
        entry["sha256"] = checksum
        mapped = mapping_items.get(entry["relative"])
        mapped_asset = assets_by_id.get(mapped.get("assetId")) if mapped else None
        if mapped_asset and mapped_asset.get("checksumSha256") == checksum:
            continue
        existing = assets_by_checksum.get(checksum)
        if existing:
            mapping_items[entry["relative"]] = {
                "sha256": checksum,
                "assetId": existing["id"],
                "virtualPath": existing["virtualPath"],
                "category": entry["category"],
                "reused": True,
            }
            continue
        primary = pending_by_checksum.setdefault(checksum, {**entry, "aliases": []})
        if primary["relative"] != entry["relative"]:
            primary["aliases"].append(entry["relative"])
        if index % 50 == 0:
            print(f"已校验源素材 {index}/{len(entries)}", flush=True)

    pending = list(pending_by_checksum.values())
    uploaded_count = 0
    for category in ("scene", "cg", "character"):
        category_pending = [item for item in pending if item["category"] == category]
        for start in range(0, len(category_pending), max(1, batch_size)):
            batch = category_pending[start : start + max(1, batch_size)]
            with ExitStack() as stack:
                files = [
                    (
                        "uploads",
                        (
                            item["path"].name,
                            stack.enter_context(item["path"].open("rb")),
                            mimetypes.guess_type(item["path"].name)[0]
                            or "application/octet-stream",
                        ),
                    )
                    for item in batch
                ]
                uploaded = request_json(
                    client,
                    "POST",
                    project_path(project_id, "/assets/batch"),
                    files=files,
                    data={"category": category},
                )
            for entry, asset in zip(batch, uploaded["items"], strict=True):
                desired_path = f"sg0/{entry['relative']}"
                patched = request_json(
                    client,
                    "PATCH",
                    project_path(project_id, f"/assets/{asset['id']}"),
                    payload={
                        "expectedRevision": asset["revision"],
                        "category": entry["category"],
                        "virtualPath": desired_path,
                        "packagingPolicy": "auto",
                    },
                )
                record = {
                    "sha256": entry["sha256"],
                    "assetId": patched["id"],
                    "virtualPath": patched["virtualPath"],
                    "category": entry["category"],
                    "reused": False,
                }
                mapping_items[entry["relative"]] = record
                for alias in entry["aliases"]:
                    mapping_items[alias] = {**record, "reused": True}
                assets_by_checksum[entry["sha256"]] = patched
            uploaded_count += len(batch)
            mapping["updatedAt"] = timestamp()
            write_json(MAP_PATH, mapping)
            print(
                f"已上传 {uploaded_count}/{len(pending)} 个新增文件",
                flush=True,
            )

    mapping["updatedAt"] = timestamp()
    write_json(MAP_PATH, mapping)
    print(
        json.dumps(
            {
                "logicalLibraryAssets": library_count,
                "logicalTotal": len(entries),
                "newUploads": len(pending),
                "mapping": str(MAP_PATH),
            },
            ensure_ascii=False,
        )
    )
    return mapping


def find_character(document: dict[str, Any], names: tuple[str, ...]) -> dict[str, Any]:
    candidates = [
        character
        for character in document.get("characters", [])
        if any(name.casefold() in character.get("name", "").casefold() for name in names)
    ]
    if not candidates:
        raise RuntimeError(f"没有找到角色：{names}")
    return candidates[0]


def first_person_okabe(document: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        character
        for character in document.get("characters", [])
        if any(name in character.get("name", "") for name in ("冈部", "岡部", "Okabe"))
    ]
    if not candidates:
        raise RuntimeError("没有找到冈部角色")
    return min(candidates, key=lambda character: len(character.get("expressions", [])))


def semantic_suzuha_expression(label: str, index: int) -> str:
    if any(word in label for word in ("爽", "笑", "开心")):
        return "cheerful"
    if any(word in label for word in ("担忧", "不安", "困惑")):
        return "worried"
    if any(word in label for word in ("严", "怒", "生气")):
        return "strict"
    if any(word in label for word in ("释然", "安心", "闭眼")):
        return "relieved"
    if any(word in label for word in ("认真", "严肃")):
        return "serious"
    return ("calm", "cheerful", "serious", "worried", "strict", "relieved")[min(index, 5)]


def ensure_story_image_asset(
    document: dict[str, Any], story_asset_id: str, role: str, file_id: str
) -> None:
    assets = document.setdefault("assets", [])
    replacement = {
        "id": story_asset_id,
        "type": "image",
        "role": role,
        "fileId": file_id,
        "status": "ready",
    }
    for index, asset in enumerate(assets):
        if asset["id"] == story_asset_id:
            assets[index] = replacement
            return
    assets.append(replacement)


def upgrade_suzuha(document: dict[str, Any], mapping: dict[str, Any], source_root: Path) -> str:
    suzuha = find_character(document, ("铃羽", "鈴羽", "玲羽", "Suzuha"))
    expressions = suzuha.get("expressions", [])
    if len(expressions) < 6:
        raise RuntimeError("铃羽至少需要六个既有语义表情")
    for index, expression in enumerate(expressions):
        semantic = semantic_suzuha_expression(expression.get("label", ""), index)
        pose, variant = SUZUHA_VARIANTS[semantic]
        frame_assets: list[str] = []
        for mouth in range(3):
            source = (
                source_root
                / "characters/amane_suzuha/sprites/variants"
                / pose
                / f"type_40_depends_{variant}_{mouth:03d}.png"
            )
            relative = source.relative_to(source_root).as_posix()
            record = mapping["items"].get(relative)
            if not record:
                raise RuntimeError(f"铃羽素材尚未上传：{relative}")
            normalized_pose = pose.lower().replace("_", "-")
            story_asset_id = f"sg0-suz-{normalized_pose}-{variant}-{mouth}"
            ensure_story_image_asset(
                document, story_asset_id, "characterPortrait", record["assetId"]
            )
            frame_assets.append(story_asset_id)
        old_frames = (expression.get("sequence") or {}).get("frames", [])
        frame_ids = [
            old_frames[mouth].get("id", f"{expression['id']}-mouth-{mouth}")
            if mouth < len(old_frames)
            else f"{expression['id']}-mouth-{mouth}"
            for mouth in range(3)
        ]
        expression["assetId"] = frame_assets[0]
        expression["renderMode"] = "frameSequence"
        expression["sequence"] = {
            "playbackMode": "lipSync",
            "fps": 8,
            "loop": True,
            "frames": [
                {"id": frame_id, "assetId": asset_id}
                for frame_id, asset_id in zip(frame_ids, frame_assets, strict=True)
            ],
        }
    return suzuha["id"]


def set_all_lip_sync_fps(document: dict[str, Any]) -> None:
    for character in document.get("characters", []):
        for expression in character.get("expressions", []):
            sequence = expression.get("sequence")
            if sequence and sequence.get("playbackMode") == "lipSync":
                sequence["fps"] = 8


def install_curated_scenes(document: dict[str, Any], mapping: dict[str, Any]) -> None:
    scenes = document.setdefault("scenes", [])
    for code, name, distance in CURATED_SCENES:
        relative = f"backgrounds/scenes/{code}.png"
        record = mapping["items"].get(relative)
        if not record:
            raise RuntimeError(f"场景素材尚未上传：{relative}")
        story_asset_id = f"sg0-scene-{code.lower()}"
        scene_id = f"sg0-{code.lower()}"
        ensure_story_image_asset(document, story_asset_id, "sceneLayer", record["assetId"])
        scene = {
            "id": scene_id,
            "name": name,
            "description": f"《命运石之门 0》原作场景 {code}",
            "layers": [
                {
                    "id": f"{scene_id}-layer",
                    "name": name,
                    "assetId": story_asset_id,
                    "distance": distance,
                    "offsetX": 0,
                    "offsetY": 0,
                }
            ],
        }
        for index, current in enumerate(scenes):
            if current["id"] == scene_id:
                scenes[index] = scene
                break
        else:
            scenes.append(scene)


def dialogue_signature(fragment: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (
            block["id"],
            block.get("characterId"),
            tuple(block.get("speakerIds") or []),
            block.get("text"),
            block.get("startMs"),
            block.get("endMs"),
        )
        for block in fragment.get("blocks", [])
        if block.get("type") == "dialogue"
    ]


def target_fragment(document: dict[str, Any]) -> dict[str, Any]:
    candidates = [
        fragment
        for chapter in document.get("chapters", [])
        for fragment in chapter.get("fragments", [])
        if fragment.get("timeline", {}).get("durationMs") == 1_780_344
    ]
    if len(candidates) != 1:
        raise RuntimeError(f"应唯一找到 29:40 时间轴，实际为 {len(candidates)} 个")
    return candidates[0]


def cast_member(
    character_id: str,
    expression_id: str | None,
    index: int,
    count: int,
    cue_index: int,
) -> dict[str, Any]:
    positions = {
        1: ("position-center",),
        2: ("position-left", "position-right"),
        3: ("position-outer-left", "position-center", "position-outer-right"),
    }[count]
    distance = "near" if index == 0 and cue_index % 7 == 0 else "far" if index else "medium"
    scale = 1.08 if distance == "near" else 0.92 if distance == "far" else 1.0
    return {
        "characterId": character_id,
        "expressionId": expression_id,
        "distance": distance,
        "positionId": positions[index],
        "transform": {
            "x": 50,
            "y": 100,
            "anchor": "bottomCenter",
            "scale": scale,
            "brightness": 1,
            "opacity": 1,
            "flipX": index == 1 and count > 1,
            "layer": 10 + index,
        },
        "transition": {"durationMs": 220, "fade": True},
    }


def visible_cast_for_dialogue(
    dialogues: list[dict[str, Any]], index: int, first_person_id: str
) -> list[str]:
    current = dialogues[index]
    speakers = [
        speaker
        for speaker in (current.get("speakerIds") or [current.get("characterId")])
        if speaker and speaker != first_person_id
    ]
    previous = dialogues[index - 1] if index else None
    if speakers and previous:
        previous_speakers = [
            speaker
            for speaker in (previous.get("speakerIds") or [previous.get("characterId")])
            if speaker and speaker != first_person_id and speaker not in speakers
        ]
        if current["startMs"] - previous["endMs"] <= 1_200:
            speakers.extend(previous_speakers[:1])
    if not speakers:
        nearby: list[dict[str, Any]] = []
        for offset in range(1, 13):
            if index + offset < len(dialogues):
                nearby.append(dialogues[index + offset])
            if index - offset >= 0:
                nearby.append(dialogues[index - offset])
        for candidate in nearby:
            candidate_speakers = [
                speaker
                for speaker in (candidate.get("speakerIds") or [candidate.get("characterId")])
                if speaker and speaker != first_person_id
            ]
            if candidate_speakers:
                speakers = candidate_speakers
                break
    return list(dict.fromkeys(speakers))[:3]


def install_performance_blocks(document: dict[str, Any], first_person_id: str) -> None:
    fragment = target_fragment(document)
    original_signature = dialogue_signature(fragment)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    if len(dialogues) != 514:
        raise RuntimeError(f"目标时间轴对白应为 514 条，实际为 {len(dialogues)} 条")
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    removed_types = {
        "scene",
        "showCharacter",
        "setStageCast",
        "removeCharacter",
        "camera",
        "resetCamera",
        "animateSprite",
    }
    retained = [
        block for block in fragment.get("blocks", []) if block.get("type") not in removed_types
    ]
    performance: list[dict[str, Any]] = []
    for beat_index, (at_ms, scene_code) in enumerate(SCENE_BEATS):
        performance.append(
            {
                "id": f"perf-scene-{beat_index:02d}",
                "type": "scene",
                "atMs": at_ms,
                "sceneId": f"sg0-{scene_code.lower()}",
                "clearCharacters": True,
            }
        )
        performance.append(
            {
                "id": f"perf-camera-{beat_index:02d}",
                "type": "camera",
                "atMs": at_ms,
                "target": "background",
                "effect": "move" if beat_index % 3 else "zoomIn",
                "x": (-2 if beat_index % 2 else 2),
                "y": -1 if beat_index % 2 else 0,
                "scale": 1 if beat_index % 4 == 3 else 1.04 + (beat_index % 3) * 0.025,
                "rotation": 0,
                "intensity": 0.5,
                "durationMs": 5_000,
                "easing": "easeInOut",
                "waitForCompletion": False,
            }
        )

    for cue_index, dialogue in enumerate(dialogues):
        visible_ids = visible_cast_for_dialogue(dialogues, cue_index, first_person_id)
        members: list[dict[str, Any]] = []
        for member_index, character_id in enumerate(visible_ids):
            expression_id = (
                dialogue.get("expressionId")
                if character_id == dialogue.get("characterId")
                else character_by_id.get(character_id, {}).get("defaultExpressionId")
            )
            members.append(
                cast_member(
                    character_id,
                    expression_id,
                    member_index,
                    len(visible_ids),
                    cue_index,
                )
            )
        explicit_group = len(dialogue.get("speakerIds") or []) > 1
        intentional_exchange = len(visible_ids) > 1 and cue_index % 3 == 0
        requires_composition = (
            dialogue["characterId"] == first_person_id or explicit_group or intentional_exchange
        )
        if requires_composition:
            performance.append(
                {
                    "id": f"perf-cast-{cue_index:03d}",
                    "type": "setStageCast",
                    "atMs": dialogue["startMs"],
                    "members": members,
                    "exitTransition": {"durationMs": 180, "fade": True},
                }
            )

        if dialogue["characterId"] == first_person_id:
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": False,
                "distance": "medium",
                "keepAfter": False,
                "transition": {"durationMs": 120, "fade": False},
            }
        else:
            speaker_member = next(
                (member for member in members if member["characterId"] == dialogue["characterId"]),
                cast_member(dialogue["characterId"], dialogue.get("expressionId"), 0, 1, cue_index),
            )
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": True,
                "distance": speaker_member["distance"],
                "positionId": speaker_member["positionId"],
                "keepAfter": False,
                "transform": speaker_member["transform"],
                "transition": {"durationMs": 160, "fade": True},
            }

        text = dialogue.get("text", "")
        if visible_ids and cue_index % 18 == 0:
            animation = (
                "startle"
                if any(mark in text for mark in ("！", "!"))
                else "lean"
                if any(mark in text for mark in ("？", "?"))
                else "nod"
            )
            performance.append(
                {
                    "id": f"perf-motion-{cue_index:03d}-0",
                    "type": "animateSprite",
                    "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 180),
                    "characterId": visible_ids[0],
                    "animation": animation,
                    "direction": "towardCenter",
                    "intensity": 0.8,
                    "easing": "easeOut",
                    "durationMs": 520,
                    "loop": False,
                    "waitForCompletion": False,
                }
            )
        if (
            len(visible_ids) >= 2
            and 1_364_000 <= dialogue["startMs"] <= 1_604_000
            and cue_index % 11 == 0
        ):
            for member_index, character_id in enumerate(visible_ids[:2]):
                performance.append(
                    {
                        "id": f"perf-motion-{cue_index:03d}-{member_index + 1}",
                        "type": "animateSprite",
                        "atMs": min(dialogue["endMs"] - 1, dialogue["startMs"] + 220),
                        "characterId": character_id,
                        "animation": "tug",
                        "direction": "right" if member_index == 0 else "left",
                        "intensity": 0.65,
                        "easing": "easeInOut",
                        "durationMs": 680,
                        "loop": False,
                        "waitForCompletion": False,
                    }
                )
        if requires_composition:
            following = dialogues[cue_index + 1] if cue_index + 1 < len(dialogues) else None
            following_ids = (
                visible_cast_for_dialogue(dialogues, cue_index + 1, first_person_id)
                if following
                else []
            )
            following_requires_composition = bool(
                following
                and (
                    following["characterId"] == first_person_id
                    or len(following.get("speakerIds") or []) > 1
                    or (len(following_ids) > 1 and (cue_index + 1) % 3 == 0)
                )
            )
            if (
                not following_requires_composition
                or following is None
                or following["startMs"] > dialogue["endMs"]
            ):
                performance.append(
                    {
                        "id": f"perf-cast-clear-{cue_index:03d}",
                        "type": "setStageCast",
                        "atMs": dialogue["endMs"],
                        "members": [],
                        "exitTransition": {"durationMs": 160, "fade": True},
                    }
                )

    if not any(
        block.get("type") == "setStageCast" and block.get("atMs") == dialogues[-1]["endMs"]
        for block in performance
    ):
        performance.append(
            {
                "id": "perf-cast-final-clear",
                "type": "setStageCast",
                "atMs": dialogues[-1]["endMs"],
                "members": [],
                "exitTransition": {"durationMs": 180, "fade": True},
            }
        )
    fragment["blocks"] = [*performance, *retained]
    if len(fragment["blocks"]) > 1000:
        raise RuntimeError(f"演出 Block 超过上限：{len(fragment['blocks'])}")
    if dialogue_signature(fragment) != original_signature:
        raise RuntimeError("演出重编意外修改了对白文本或时间轴")


def audit_document(
    document: dict[str, Any], mapping: dict[str, Any], source_root: Path
) -> dict[str, Any]:
    fragment = target_fragment(document)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    first_person_id = first_person_okabe(document)["id"]
    cast_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "setStageCast"
    ]
    lip_sync_fps = [
        expression["sequence"]["fps"]
        for character in document.get("characters", [])
        for expression in character.get("expressions", [])
        if expression.get("sequence", {}).get("playbackMode") == "lipSync"
    ]
    scene_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "scene"]
    camera_blocks = [block for block in fragment.get("blocks", []) if block.get("type") == "camera"]
    stage_events = sorted(
        [
            block
            for block in fragment.get("blocks", [])
            if block.get("type") in {"scene", "setStageCast"} and block.get("atMs") is not None
        ],
        key=lambda block: (block["atMs"], 0 if block["type"] == "scene" else 1),
    )

    def cast_at(milliseconds: int) -> list[dict[str, Any]]:
        members: list[dict[str, Any]] = []
        for event in stage_events:
            if event["atMs"] > milliseconds:
                break
            if event["type"] == "scene" and event.get("clearCharacters", True):
                members = []
            elif event["type"] == "setStageCast":
                members = event.get("members", [])
        return members

    silent_gaps = [
        (dialogues[index]["endMs"], dialogues[index + 1]["startMs"])
        for index in range(len(dialogues) - 1)
        if dialogues[index + 1]["startMs"] - dialogues[index]["endMs"] > 80
    ]
    nonempty_silent_gaps = [
        (start, end) for start, end in silent_gaps if cast_at(start + (end - start) // 2)
    ]
    first_person_without_reaction = [
        dialogue["id"]
        for dialogue in dialogues
        if dialogue["characterId"] == first_person_id and not cast_at(dialogue["startMs"])
    ]
    suzuha = find_character(document, ("铃羽", "鈴羽", "玲羽", "Suzuha"))
    suzuha_asset_ids = {
        expression.get("assetId", "") for expression in suzuha.get("expressions", [])
    }
    logical_library = logical_library_entries(source_root)
    missing_mapping = [
        item["relative"]
        for item in logical_library
        if item["relative"] not in mapping.get("items", {})
    ]
    checks = {
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueCount": len(dialogues),
        "allLipSyncFps8": bool(lip_sync_fps) and set(lip_sync_fps) == {8},
        "maxCastSize": max((len(block.get("members", [])) for block in cast_blocks), default=0),
        "firstPersonNeverVisible": all(
            first_person_id not in {member["characterId"] for member in block.get("members", [])}
            for block in cast_blocks
        ),
        "sceneBeatCount": len(scene_blocks),
        "distinctSceneCount": len({block["sceneId"] for block in scene_blocks}),
        "cameraBeatCount": len(camera_blocks),
        "cameraUiIsolationReady": all(
            block.get("target") == "background" for block in camera_blocks
        ),
        "silentGapCount": len(silent_gaps),
        "nonemptySilentGaps": nonempty_silent_gaps,
        "firstPersonLinesWithoutReaction": first_person_without_reaction,
        "suzuhaUsesSg0BlueVest": bool(suzuha_asset_ids)
        and all(asset_id.startswith("sg0-suz-suz-hs") for asset_id in suzuha_asset_ids)
        and any("hsd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hse" in asset_id for asset_id in suzuha_asset_ids),
        "logicalLibraryCount": len(logical_library),
        "missingLogicalMappings": missing_mapping,
    }
    if checks["durationMs"] != 1_780_344 or checks["dialogueCount"] != 514:
        raise RuntimeError(f"对白或时间轴审计失败：{checks}")
    if not checks["allLipSyncFps8"]:
        raise RuntimeError("仍有唇形序列不是 8 FPS")
    if checks["maxCastSize"] > 3 or not checks["firstPersonNeverVisible"]:
        raise RuntimeError("舞台人数或第一人称冈部审计失败")
    if checks["sceneBeatCount"] < 12 or checks["distinctSceneCount"] < 8:
        raise RuntimeError("场景丰富度没有达到验收条件")
    if (
        checks["cameraBeatCount"] < 12
        or not checks["cameraUiIsolationReady"]
        or checks["nonemptySilentGaps"]
        or checks["firstPersonLinesWithoutReaction"]
        or not checks["suzuhaUsesSg0BlueVest"]
    ):
        raise RuntimeError(
            "镜头、静默区间、第一人称反应或铃羽素材审计失败："
            + json.dumps(
                {
                    key: checks[key]
                    for key in (
                        "cameraBeatCount",
                        "cameraUiIsolationReady",
                        "nonemptySilentGaps",
                        "firstPersonLinesWithoutReaction",
                        "suzuhaUsesSg0BlueVest",
                    )
                },
                ensure_ascii=False,
            )
        )
    if checks["logicalLibraryCount"] != 701 or missing_mapping:
        raise RuntimeError("原作素材映射不完整")
    return checks


def transform_latest_story(
    latest: dict[str, Any], mapping: dict[str, Any], source_root: Path
) -> tuple[dict[str, Any], dict[str, Any]]:
    document = deepcopy(latest["document"])
    fragment = target_fragment(document)
    baseline = {
        "revision": latest["revision"],
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueSignature": dialogue_signature(fragment),
    }
    install_curated_scenes(document, mapping)
    upgrade_suzuha(document, mapping, source_root)
    set_all_lip_sync_fps(document)
    first_person_id = first_person_okabe(document)["id"]
    install_performance_blocks(document, first_person_id)
    checks = audit_document(document, mapping, source_root)
    if dialogue_signature(target_fragment(document)) != baseline["dialogueSignature"]:
        raise RuntimeError("最终审计发现对白发生变化")
    return document, {"baseline": baseline, "checks": checks}


def apply_story(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        backup_path = BACKUP_ROOT / f"{timestamp()}-performance-before.json"
        write_json(backup_path, latest)
        document, audit = transform_latest_story(latest, mapping, source_root)
        try:
            saved = request_json(
                client,
                "PUT",
                project_path(project_id, "/story"),
                payload={"expected_revision": latest["revision"], "document": document},
            )
        except ApiError as exc:
            if exc.status_code == 409 and attempt < 3:
                print("故事 revision 已变化，重新读取并重算演出", flush=True)
                continue
            raise
        audit_path = BACKUP_ROOT / f"{timestamp()}-performance-apply-audit.json"
        write_json(
            audit_path,
            {
                **audit,
                "beforeSnapshot": str(backup_path),
                "savedRevision": saved["revision"],
            },
        )
        print(
            json.dumps(
                {
                    "savedRevision": saved["revision"],
                    "audit": str(audit_path),
                },
                ensure_ascii=False,
            )
        )
        return saved
    raise RuntimeError("连续三次 revision 冲突，未覆盖任何故事数据")


def inspect(client: httpx.Client, project_id: str) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    fragment = target_fragment(story["document"])
    summary = {
        "revision": story["revision"],
        "durationMs": fragment.get("timeline", {}).get("durationMs"),
        "dialogueCount": len(dialogue_signature(fragment)),
        "characters": [
            {
                "id": character["id"],
                "name": character["name"],
                "expressions": len(character.get("expressions", [])),
            }
            for character in story["document"].get("characters", [])
        ],
    }
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return summary


def audit_live(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    existing_ids = {asset["id"] for asset in listed}
    missing_assets = [
        relative
        for relative, item in mapping.get("items", {}).items()
        if item["assetId"] not in existing_ids
    ]
    checks = audit_document(story["document"], mapping, source_root)
    checks["missingProjectAssets"] = missing_assets
    if missing_assets:
        raise RuntimeError("映射中的项目素材记录不存在")
    audit_path = BACKUP_ROOT / f"{timestamp()}-performance-final-audit.json"
    write_json(audit_path, {"revision": story["revision"], "checks": checks})
    print(json.dumps({"audit": str(audit_path), **checks}, ensure_ascii=False))
    return checks


def main() -> None:
    args = parse_args()
    secrets = dotenv_values(REPO_ROOT / "backend" / ".env")
    management_key = (secrets.get("FPL_MANAGEMENT_API_KEY") or "").strip()
    if not management_key.startswith("fpm_"):
        raise RuntimeError("backend/.env 未配置可用的 FPL_MANAGEMENT_API_KEY")
    if not args.source_root.is_dir():
        raise RuntimeError(f"SG0 素材目录不存在：{args.source_root}")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        if args.action == "inspect":
            inspect(client, args.project_id)
            return
        mapping = load_asset_map(args.project_id, args.source_root)
        if args.action in {"upload", "all"}:
            mapping = upload_assets(
                client,
                args.project_id,
                args.source_root,
                args.batch_size,
            )
        if args.action in {"apply", "all"}:
            apply_story(client, args.project_id, mapping, args.source_root)
        if args.action in {"audit", "all"}:
            audit_live(client, args.project_id, mapping, args.source_root)


if __name__ == "__main__":
    main()
