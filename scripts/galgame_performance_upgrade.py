from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
from contextlib import ExitStack
from copy import deepcopy
from datetime import UTC, datetime
from math import floor
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

try:
    from scripts.galgame_runaway_cues import (
        CG_SPECS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )
except ModuleNotFoundError:
    from galgame_runaway_cues import (  # type: ignore[no-redef]
        CG_SPECS,
        DISTANCE_SCALES,
        SAFE_CLOSEUP_DIALOGUE_IDS,
        TOP_SAFE_PERCENT,
    )

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_PROJECT_ID = "63ac832d-bff3-4053-9c9f-f55c9dafc52a"
DEFAULT_SOURCE_ROOT = Path("/Users/tonghao/Projects/steins-gate-video/assets/games/steins_gate_0")
DEFAULT_ANNOTATION_PATH = Path("/Users/tonghao/Downloads/广播剧.annotation (6).json")
BACKUP_ROOT = REPO_ROOT / ".runtime" / "galgame-import-backups"
MAP_PATH = BACKUP_ROOT / "sg0-performance-asset-map.json"
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
LIP_SYNC_FPS = 10
EXPECTED_ANNOTATION_TEXT_CHANGES = 189
EXPECTED_ANNOTATION_SPEAKER_CHANGES = 10
EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES = 12
MOTION_SAFE_PERCENT = 4.0
STAGE_BOTTOM_PERCENT = 100.0
EXPRESSION_CUES_PATH = REPO_ROOT / "scripts" / "galgame_runaway_expression_cues.json"
DIALOGUE_EXPRESSION_CUES: dict[str, str] = json.loads(
    EXPRESSION_CUES_PATH.read_text(encoding="utf-8")
)

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

CUSTOM_SCENES = (
    {
        "code": "BG11A7_TWO",
        "name": "双时光机屋顶",
        "description": "基于原作 BG11A7 补全铃羽第二台时光机的屋顶场景。",
        "path": REPO_ROOT / "docs/assets/galgame-runaway-scenes/BG11A7-two-time-machines-v1.png",
        "relative": "project-scenes/BG11A7-two-time-machines-v1.png",
        "distance": 0.92,
    },
)

SCENE_BEATS = (
    (0, "BG03A1"),
    (28_000, "BG03A2"),
    (151_754, "BG03A5"),
    (260_255, "BG03A3"),
    (373_608, "BG11A7"),
    (653_198, "BG11A7_TWO"),
    (687_072, "BG03A1"),
    (970_000, "BG03A2"),
    (1_188_000, "BG03A5"),
    (1_300_000, "BG03A4"),
    (1_364_000, "BG03A3"),
    (1_604_000, "BG11A7"),
    (1_680_000, "BG11A3"),
    (1_682_974, "BG03A5"),
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
    parser.add_argument("--annotation", type=Path, default=DEFAULT_ANNOTATION_PATH)
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
    entries.extend(
        {
            "path": spec["path"] if spec["path"].is_absolute() else REPO_ROOT / spec["path"],
            "relative": spec["relative"],
            "category": "cg",
        }
        for spec in CG_SPECS
    )
    entries.extend(
        {
            "path": spec["path"],
            "relative": spec["relative"],
            "category": "scene",
        }
        for spec in CUSTOM_SCENES
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
            "fps": LIP_SYNC_FPS,
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
                sequence["fps"] = LIP_SYNC_FPS


def enlarge_dialogue_text(document: dict[str, Any]) -> None:
    dialogue_box = document.setdefault("presentation", {}).setdefault("dialogueBox", {})
    body = dialogue_box.setdefault("body", {})
    body["fontSizePx"] = 34
    body["lineHeight"] = 1.5


def install_curated_scenes(document: dict[str, Any], mapping: dict[str, Any]) -> None:
    scenes = document.setdefault("scenes", [])
    specs = [
        {
            "code": code,
            "name": name,
            "description": f"《命运石之门 0》原作场景 {code}",
            "relative": f"backgrounds/scenes/{code}.png",
            "distance": distance,
        }
        for code, name, distance in CURATED_SCENES
    ]
    specs.extend(CUSTOM_SCENES)
    for spec in specs:
        code = spec["code"]
        name = spec["name"]
        relative = spec["relative"]
        record = mapping["items"].get(relative)
        if not record:
            raise RuntimeError(f"场景素材尚未上传：{relative}")
        code_slug = code.lower().replace("_", "-")
        story_asset_id = f"sg0-scene-{code_slug}"
        scene_id = f"sg0-{code_slug}"
        ensure_story_image_asset(document, story_asset_id, "sceneLayer", record["assetId"])
        scene = {
            "id": scene_id,
            "name": name,
            "description": spec["description"],
            "layers": [
                {
                    "id": f"{scene_id}-layer",
                    "name": name,
                    "assetId": story_asset_id,
                    "distance": spec["distance"],
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


def install_cgs(document: dict[str, Any], mapping: dict[str, Any]) -> None:
    cgs = document.setdefault("cgs", [])
    cg_by_id = {cg["id"]: index for index, cg in enumerate(cgs)}
    for spec in CG_SPECS:
        record = mapping.get("items", {}).get(spec["relative"])
        if not record:
            raise RuntimeError(f"CG 素材尚未上传：{spec['relative']}")
        ensure_story_image_asset(document, spec["storyAssetId"], "storyCg", record["assetId"])
        cg = {
            "id": spec["cgId"],
            "name": spec["name"],
            "description": spec["description"],
            "variants": [
                {
                    "id": spec["variantId"],
                    "label": "默认",
                    "assetId": spec["storyAssetId"],
                }
            ],
            "defaultVariantId": spec["variantId"],
        }
        if spec["cgId"] in cg_by_id:
            cgs[cg_by_id[spec["cgId"]]] = cg
        else:
            cg_by_id[spec["cgId"]] = len(cgs)
            cgs.append(cg)

    fragment = target_fragment(document)
    retained = [
        block
        for block in fragment.get("blocks", [])
        if not (
            block.get("type") in {"showCg", "hideCg"}
            and block.get("id", "").startswith("runaway-cg-")
        )
    ]
    cg_events: list[dict[str, Any]] = []
    for spec in CG_SPECS:
        transition = {"durationMs": spec["transitionMs"], "fade": True}
        cg_events.append(
            {
                "id": f"runaway-cg-show-{spec['key']}",
                "type": "showCg",
                "atMs": spec["startMs"],
                "cgId": spec["cgId"],
                "variantId": spec["variantId"],
                "displayMode": "fullscreen",
                "fit": "cover",
                "overlay": {
                    "x": 50,
                    "y": 50,
                    "width": 60,
                    "opacity": 1,
                    "placement": "frontOfCharacters",
                },
                "transition": transition,
            }
        )
        if spec["endMs"] is not None:
            cg_events.append(
                {
                    "id": f"runaway-cg-hide-{spec['key']}",
                    "type": "hideCg",
                    "atMs": spec["endMs"],
                    "transition": transition,
                }
            )
    fragment["blocks"] = [*retained, *cg_events]


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


def dialogue_timeline_signature(fragment: dict[str, Any]) -> list[tuple[Any, ...]]:
    return [
        (
            block["id"],
            block.get("startMs"),
            block.get("endMs"),
            block.get("voiceAssetId"),
            block.get("voiceVolume"),
        )
        for block in fragment.get("blocks", [])
        if block.get("type") == "dialogue"
    ]


def annotation_text(segment: dict[str, Any]) -> str:
    return next(
        (
            localized["text"]
            for localized in segment.get("localized_texts", [])
            if localized.get("language") == "zh"
        ),
        segment["text"],
    )


def annotation_character_map(
    document: dict[str, Any], annotation: dict[str, Any]
) -> dict[str, str]:
    first_person_id = first_person_okabe(document)["id"]
    fixed = {
        "冈部伦太郎": first_person_id,
        "牧濑红莉栖": find_character(document, ("牧濑红莉栖",))["id"],
        "椎名真由理": find_character(document, ("椎名真由理",))["id"],
        "桥田至": find_character(document, ("桥田至",))["id"],
        "菲莉丝·喵喵": find_character(document, ("菲莉丝",))["id"],
        "阿万音铃羽": find_character(document, ("阿万音铃羽",))["id"],
        "幼年篝": find_character(document, ("幼年篝",))["id"],
        "漆原琉华": find_character(document, ("漆原琉华",))["id"],
        "比屋定真帆": find_character(document, ("比屋定真帆",))["id"],
        "桐生萌郁": find_character(document, ("桐生萌郁",))["id"],
        "天王寺裕吾": find_character(document, ("天王寺裕吾",))["id"],
        "众人": find_character(document, ("众人",))["id"],
    }
    mapping = {speaker["id"]: fixed[speaker["name"]] for speaker in annotation.get("speakers", [])}
    if len(mapping) != 12:
        raise RuntimeError(f"标注说话人应为 12 名，实际为 {len(mapping)} 名")
    return mapping


def apply_annotation(document: dict[str, Any], annotation_path: Path) -> dict[str, Any]:
    if not annotation_path.is_file():
        raise RuntimeError(f"新版对白标注不存在：{annotation_path}")
    annotation = json.loads(annotation_path.read_text(encoding="utf-8"))
    segments = annotation.get("segments", [])
    if len(segments) != 514:
        raise RuntimeError(f"新版对白标注应为 514 条，实际为 {len(segments)} 条")
    fragment = target_fragment(document)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    by_interval = {(block["startMs"], block["endMs"]): block for block in dialogues}
    if len(by_interval) != len(dialogues):
        raise RuntimeError("现有对白时间区间并非唯一，无法精确对齐新版标注")
    speaker_map = annotation_character_map(document, annotation)
    changed_text_count = 0
    changed_speaker_count = 0
    multi_speaker_count = 0
    expected: list[tuple[Any, ...]] = []
    for segment in segments:
        interval = (segment["start_ms"], segment["end_ms"])
        dialogue = by_interval.get(interval)
        if dialogue is None:
            raise RuntimeError(f"新版对白无法按时间对齐：{interval}")
        text = annotation_text(segment)
        character_id = speaker_map[segment["speaker_id"]]
        speaker_ids = [speaker_map[speaker_id] for speaker_id in segment["speaker_ids"]]
        if dialogue.get("text") != text:
            changed_text_count += 1
        if dialogue.get("characterId") != character_id:
            changed_speaker_count += 1
        if len(speaker_ids) > 1:
            multi_speaker_count += 1
        dialogue["text"] = text
        dialogue["characterId"] = character_id
        dialogue["speakerIds"] = speaker_ids
        expected.append(
            (
                dialogue["id"],
                character_id,
                tuple(speaker_ids),
                text,
                segment["start_ms"],
                segment["end_ms"],
            )
        )
    if len(dialogues) != len(expected):
        raise RuntimeError("新版对白没有完整覆盖现有 514 个对白 Block")
    return {
        "path": str(annotation_path),
        "sha256": sha256(annotation_path),
        "changedTextCount": changed_text_count,
        "changedSpeakerCount": changed_speaker_count,
        "multiSpeakerCount": multi_speaker_count,
        "expectedChangedTextCount": EXPECTED_ANNOTATION_TEXT_CHANGES,
        "expectedChangedSpeakerCount": EXPECTED_ANNOTATION_SPEAKER_CHANGES,
        "expectedMultiSpeakerCount": EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES,
        "expectedDialogueSignature": expected,
    }


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


def portrait_height_percent(
    document: dict[str, Any], character_id: str, expression_id: str | None
) -> float:
    character = next(item for item in document.get("characters", []) if item["id"] == character_id)
    expression = next(
        (item for item in character.get("expressions", []) if item["id"] == expression_id),
        None,
    )
    settings = document.get("settings", {})
    override = settings.get("characterStageOverrides", {}).get(character_id, {})
    return float(
        (expression or {}).get("heightPercent")
        or override.get("defaultHeightPercent")
        or character.get("portraitHeightPercent")
        or settings.get("characterStage", {}).get("defaultHeightPercent")
        or 100
    )


def cast_member(
    document: dict[str, Any],
    character_id: str,
    expression_id: str | None,
    index: int,
    count: int,
    dialogue_id: str,
) -> dict[str, Any]:
    curated_positions = {
        1: (("performance-center", 50),),
        2: (("performance-left", 30), ("performance-right", 70)),
        3: (
            ("performance-outer-left", 18),
            ("performance-center", 50),
            ("performance-outer-right", 82),
        ),
    }
    if count <= 3:
        positions = curated_positions[count]
    else:
        left = 6.0
        right = 94.0
        step = (right - left) / (count - 1)
        positions = tuple(
            (f"performance-row-{count}-{position_index + 1}", left + step * position_index)
            for position_index in range(count)
        )
    distance = (
        "near"
        if count == 1 and dialogue_id in SAFE_CLOSEUP_DIALOGUE_IDS
        else "far"
        if count >= 4 or (count > 1 and index > 0)
        else "medium"
    )
    height = portrait_height_percent(document, character_id, expression_id)
    effective_height = height * DISTANCE_SCALES[distance]
    available_height = STAGE_BOTTOM_PERCENT - TOP_SAFE_PERCENT - MOTION_SAFE_PERCENT
    equal_row_scale_caps = {4: 0.72, 5: 0.62, 6: 0.54, 7: 0.47, 8: 0.42}
    scale_cap = equal_row_scale_caps.get(count, 1.0)
    scale = floor(min(scale_cap, available_height / effective_height) * 1000) / 1000
    if scale < 0.25:
        raise RuntimeError(f"角色 {character_id} 的立绘过高，无法在贴底后保留安全头部")
    return {
        "characterId": character_id,
        "expressionId": expression_id,
        "distance": distance,
        "positionId": positions[index][0],
        "transform": {
            "x": positions[index][1],
            "y": STAGE_BOTTOM_PERCENT,
            "anchor": "bottomCenter",
            "scale": scale,
            "brightness": 1,
            "opacity": 1,
            "flipX": index == 1 and count > 1,
            "layer": 10 + index,
        },
        "transition": {"durationMs": 0, "fade": False},
    }


def visible_cast_for_dialogue(
    dialogues: list[dict[str, Any]],
    index: int,
    first_person_id: str,
    visible_character_ids: set[str],
) -> list[str]:
    current = dialogues[index]
    if current["id"] in SAFE_CLOSEUP_DIALOGUE_IDS:
        return (
            [current["characterId"]] if current.get("characterId") in visible_character_ids else []
        )
    explicit_group = len(current.get("speakerIds") or []) > 1
    speakers = [
        speaker
        for speaker in (current.get("speakerIds") or [current.get("characterId")])
        if speaker and speaker != first_person_id and speaker in visible_character_ids
    ]
    if explicit_group:
        return list(dict.fromkeys(speakers))[:8]
    if current.get("characterId") not in visible_character_ids:
        return []
    previous = dialogues[index - 1] if index else None
    if speakers and previous:
        previous_speakers = [
            speaker
            for speaker in (previous.get("speakerIds") or [previous.get("characterId")])
            if speaker
            and speaker != first_person_id
            and speaker in visible_character_ids
            and speaker not in speakers
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
                if speaker and speaker != first_person_id and speaker in visible_character_ids
            ]
            if candidate_speakers:
                speakers = candidate_speakers
                break
    return list(dict.fromkeys(speakers))[:3]


def remembered_cast_expression(
    character_id: str,
    dialogue: dict[str, Any],
    character_by_id: dict[str, dict[str, Any]],
    last_expression_by_character: dict[str, str],
) -> str | None:
    if character_id == dialogue.get("characterId"):
        return dialogue.get("expressionId")
    return last_expression_by_character.get(character_id) or character_by_id.get(
        character_id, {}
    ).get("defaultExpressionId")


def install_performance_blocks(document: dict[str, Any], first_person_id: str) -> None:
    fragment = target_fragment(document)
    original_signature = dialogue_signature(fragment)
    dialogues = [block for block in fragment.get("blocks", []) if block.get("type") == "dialogue"]
    if len(dialogues) != 514:
        raise RuntimeError(f"目标时间轴对白应为 514 条，实际为 {len(dialogues)} 条")
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character["id"]
        for character in document.get("characters", [])
        if character.get("expressions") and character["id"] != first_person_id
    }
    removed_types = {
        "scene",
        "showCharacter",
        "setStageCast",
        "removeCharacter",
        "camera",
        "resetCamera",
        "animateSprite",
        "curtain",
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
                "sceneId": f"sg0-{scene_code.lower().replace('_', '-')}",
                "clearCharacters": True,
                "transition": {
                    "durationMs": 0 if beat_index == 0 else 350,
                    "fade": beat_index != 0,
                },
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

    last_expression_by_character: dict[str, str] = {}
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids:
            try:
                dialogue["expressionId"] = DIALOGUE_EXPRESSION_CUES[dialogue["id"]]
            except KeyError as exc:
                raise RuntimeError(f"对白缺少显式表情：{dialogue['id']}") from exc
            last_expression_by_character[character_id] = dialogue["expressionId"]
        else:
            dialogue.pop("expressionId", None)
        visible_ids = visible_cast_for_dialogue(
            dialogues, cue_index, first_person_id, visible_character_ids
        )
        members: list[dict[str, Any]] = []
        for member_index, character_id in enumerate(visible_ids):
            expression_id = remembered_cast_expression(
                character_id,
                dialogue,
                character_by_id,
                last_expression_by_character,
            )
            members.append(
                cast_member(
                    document,
                    character_id,
                    expression_id,
                    member_index,
                    len(visible_ids),
                    dialogue["id"],
                )
            )
        explicit_group = len(dialogue.get("speakerIds") or []) > 1
        intentional_exchange = len(visible_ids) > 1 and cue_index % 3 == 0
        requires_composition = (
            dialogue["characterId"] not in visible_character_ids
            or explicit_group
            or intentional_exchange
            or dialogue["id"] in SAFE_CLOSEUP_DIALOGUE_IDS
        )
        if requires_composition:
            performance.append(
                {
                    "id": f"perf-cast-{cue_index:03d}",
                    "type": "setStageCast",
                    "atMs": dialogue["startMs"],
                    "members": members,
                    "exitTransition": {"durationMs": 0, "fade": False},
                }
            )

        if dialogue["characterId"] not in visible_character_ids:
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": False,
                "distance": "medium",
                "keepAfter": True,
                "transition": {"durationMs": 0, "fade": False},
            }
        else:
            speaker_member = next(
                (member for member in members if member["characterId"] == dialogue["characterId"]),
                cast_member(
                    document,
                    dialogue["characterId"],
                    dialogue.get("expressionId"),
                    0,
                    1,
                    dialogue["id"],
                ),
            )
            dialogue["portrait"] = {
                "mode": "stage",
                "visible": True,
                "distance": speaker_member["distance"],
                "positionId": speaker_member["positionId"],
                "keepAfter": True,
                "transform": speaker_member["transform"],
                "transition": {"durationMs": 0, "fade": False},
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
                "exitTransition": {"durationMs": 0, "fade": False},
            }
        )
    fragment["blocks"] = [*performance, *retained]
    if len(fragment["blocks"]) > 1000:
        raise RuntimeError(f"演出 Block 超过上限：{len(fragment['blocks'])}")
    if dialogue_signature(fragment) != original_signature:
        raise RuntimeError("演出重编意外修改了对白文本或时间轴")


def audit_document(
    document: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    annotation_audit: dict[str, Any] | None = None,
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
    curtain_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "curtain"
    ]
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
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    visible_character_ids = {
        character_id
        for character_id, character in character_by_id.items()
        if character.get("expressions") and character_id != first_person_id
    }
    visible_dialogues = [
        dialogue for dialogue in dialogues if dialogue.get("characterId") in visible_character_ids
    ]
    hidden_dialogues = [
        dialogue
        for dialogue in dialogues
        if dialogue.get("characterId") not in visible_character_ids
    ]
    expression_ids = {
        character_id: {expression["id"] for expression in character.get("expressions", [])}
        for character_id, character in character_by_id.items()
    }
    invalid_expression_dialogues = [
        dialogue["id"]
        for dialogue in visible_dialogues
        if dialogue.get("expressionId") not in expression_ids.get(dialogue["characterId"], set())
        or DIALOGUE_EXPRESSION_CUES.get(dialogue["id"]) != dialogue.get("expressionId")
    ]
    visible_hidden_portraits = [
        dialogue["id"]
        for dialogue in visible_dialogues
        if not dialogue.get("portrait", {}).get("visible")
    ]
    hidden_visible_portraits = [
        dialogue["id"]
        for dialogue in hidden_dialogues
        if dialogue.get("portrait", {}).get("visible")
    ]
    cast_block_by_id = {block["id"]: block for block in cast_blocks}
    stale_cast_expressions: list[dict[str, Any]] = []
    last_expression_by_character: dict[str, str] = {}
    character_by_id = {character["id"]: character for character in document.get("characters", [])}
    for cue_index, dialogue in enumerate(dialogues):
        character_id = dialogue.get("characterId")
        if character_id in visible_character_ids and dialogue.get("expressionId"):
            last_expression_by_character[character_id] = dialogue["expressionId"]
        block = cast_block_by_id.get(f"perf-cast-{cue_index:03d}")
        if not block:
            continue
        for member in block.get("members", []):
            expected = last_expression_by_character.get(
                member["characterId"]
            ) or character_by_id.get(member["characterId"], {}).get("defaultExpressionId")
            if member.get("expressionId") != expected:
                stale_cast_expressions.append(
                    {
                        "owner": block["id"],
                        "characterId": member["characterId"],
                        "expected": expected,
                        "actual": member.get("expressionId"),
                    }
                )

    unsafe_frames: list[dict[str, Any]] = []
    floating_frames: list[dict[str, Any]] = []

    def check_safe_frame(
        *,
        owner: str,
        character_id: str,
        expression_id: str | None,
        distance: str,
        transform: dict[str, Any],
    ) -> None:
        height = portrait_height_percent(document, character_id, expression_id)
        effective_height = (
            height * DISTANCE_SCALES.get(distance, 1.0) * float(transform.get("scale", 1))
        )
        top = float(transform.get("y", 100)) - effective_height
        if top < TOP_SAFE_PERCENT:
            unsafe_frames.append({"owner": owner, "topPercent": round(top, 3)})
        if (
            transform.get("anchor", "bottomCenter") == "bottomCenter"
            and float(transform.get("y", 100)) != STAGE_BOTTOM_PERCENT
        ):
            floating_frames.append(
                {"owner": owner, "bottomPercent": float(transform.get("y", 100))}
            )

    for block in cast_blocks:
        for member in block.get("members", []):
            check_safe_frame(
                owner=block["id"],
                character_id=member["characterId"],
                expression_id=member.get("expressionId"),
                distance=member["distance"],
                transform=member["transform"],
            )
    for dialogue in visible_dialogues:
        portrait = dialogue["portrait"]
        check_safe_frame(
            owner=dialogue["id"],
            character_id=dialogue["characterId"],
            expression_id=dialogue.get("expressionId"),
            distance=portrait["distance"],
            transform=portrait["transform"],
        )

    near_dialogue_ids = {
        dialogue["id"]
        for dialogue in visible_dialogues
        if dialogue.get("portrait", {}).get("distance") == "near"
    }
    show_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "showCg"
    ]
    hide_cg_blocks = [
        block for block in fragment.get("blocks", []) if block.get("type") == "hideCg"
    ]
    managed_cg_ids = {spec["cgId"] for spec in CG_SPECS}
    cg_event_ids = [block["id"] for block in [*show_cg_blocks, *hide_cg_blocks]]
    cg_intervals = sorted(
        (spec["startMs"], spec["endMs"], spec["key"])
        for spec in CG_SPECS
        if spec["endMs"] is not None and not spec["key"].startswith("q-")
    )
    cg_overlaps = [
        (left[2], right[2])
        for left, right in zip(cg_intervals, cg_intervals[1:], strict=False)
        if left[1] is not None and left[1] > right[0]
    ]
    scene_beats = [(block["atMs"], block["sceneId"]) for block in scene_blocks]
    expected_scene_beats = [
        (at_ms, f"sg0-{scene_code.lower().replace('_', '-')}") for at_ms, scene_code in SCENE_BEATS
    ]
    scene_events_inside_cgs = [
        {
            "sceneBlockId": block["id"],
            "atMs": block["atMs"],
            "cg": spec["key"],
        }
        for block in scene_blocks
        for spec in CG_SPECS
        if spec["endMs"] is not None and spec["startMs"] < block["atMs"] < spec["endMs"]
    ]
    character_fades = [
        block["id"]
        for block in fragment.get("blocks", [])
        if block.get("type") == "setStageCast"
        and (
            (block.get("exitTransition") or {}).get("fade")
            or any(
                (member.get("transition") or {}).get("fade") for member in block.get("members", [])
            )
        )
    ] + [
        dialogue["id"]
        for dialogue in dialogues
        if (dialogue.get("portrait", {}).get("transition") or {}).get("fade")
    ]
    overlong_story_cgs = [
        {
            "key": spec["key"],
            "durationMs": spec["endMs"] - spec["startMs"],
        }
        for spec in CG_SPECS
        if not spec["key"].startswith("q-")
        and spec["endMs"] is not None
        and spec["endMs"] - spec["startMs"] > 8_000
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
    missing_cg_mapping = [
        spec["relative"] for spec in CG_SPECS if spec["relative"] not in mapping.get("items", {})
    ]
    checks = {
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueCount": len(dialogues),
        "allLipSyncFps10": bool(lip_sync_fps) and set(lip_sync_fps) == {LIP_SYNC_FPS},
        "dialogueBodyFontSizePx": document.get("presentation", {})
        .get("dialogueBox", {})
        .get("body", {})
        .get("fontSizePx"),
        "explicitExpressionCueCount": len(DIALOGUE_EXPRESSION_CUES),
        "visibleDialogueCount": len(visible_dialogues),
        "hiddenDialogueCount": len(hidden_dialogues),
        "invalidExpressionDialogues": invalid_expression_dialogues,
        "visibleHiddenPortraits": visible_hidden_portraits,
        "hiddenVisiblePortraits": hidden_visible_portraits,
        "staleCastExpressions": stale_cast_expressions,
        "nearDialogueCount": len(near_dialogue_ids),
        "nearDialogueIdsMatchCurated": near_dialogue_ids == SAFE_CLOSEUP_DIALOGUE_IDS,
        "unsafeCharacterFrames": unsafe_frames,
        "floatingCharacterFrames": floating_frames,
        "maxCastSize": max((len(block.get("members", [])) for block in cast_blocks), default=0),
        "firstPersonNeverVisible": all(
            first_person_id not in {member["characterId"] for member in block.get("members", [])}
            for block in cast_blocks
        ),
        "sceneBeatCount": len(scene_blocks),
        "sceneBeatsExact": scene_beats == expected_scene_beats,
        "sceneEventsInsideCgs": scene_events_inside_cgs,
        "distinctSceneCount": len({block["sceneId"] for block in scene_blocks}),
        "cameraBeatCount": len(camera_blocks),
        "cameraUiIsolationReady": all(
            block.get("target") == "background" for block in camera_blocks
        ),
        "silentGapCount": len(silent_gaps),
        "nonemptySilentGaps": nonempty_silent_gaps,
        "curtainCount": len(curtain_blocks),
        "characterFadeBlocks": character_fades,
        "showCgCount": len(show_cg_blocks),
        "hideCgCount": len(hide_cg_blocks),
        "managedCgDefinitionsReady": managed_cg_ids <= {cg["id"] for cg in document.get("cgs", [])},
        "duplicateCgEventIds": len(cg_event_ids) != len(set(cg_event_ids)),
        "cgOverlaps": cg_overlaps,
        "overlongStoryCgs": overlong_story_cgs,
        "suzuhaUsesSg0BlueVest": bool(suzuha_asset_ids)
        and all(asset_id.startswith("sg0-suz-suz-hs") for asset_id in suzuha_asset_ids)
        and any("hsd" in asset_id for asset_id in suzuha_asset_ids)
        and any("hse" in asset_id for asset_id in suzuha_asset_ids),
        "logicalLibraryCount": len(logical_library),
        "missingLogicalMappings": missing_mapping,
        "missingCgMappings": missing_cg_mapping,
        "blockCount": len(fragment.get("blocks", [])),
        "annotation": annotation_audit,
    }
    if checks["durationMs"] != 1_780_344 or checks["dialogueCount"] != 514:
        raise RuntimeError(f"对白或时间轴审计失败：{checks}")
    if not checks["allLipSyncFps10"]:
        raise RuntimeError("仍有唇形序列不是 10 FPS")
    if checks["dialogueBodyFontSizePx"] != 34:
        raise RuntimeError("对白正文字号没有应用到 34px")
    if (
        checks["explicitExpressionCueCount"] != 409
        or checks["visibleDialogueCount"] != 409
        or checks["hiddenDialogueCount"] != 105
        or invalid_expression_dialogues
        or visible_hidden_portraits
        or hidden_visible_portraits
        or stale_cast_expressions
    ):
        raise RuntimeError("逐句表情或隐藏人物审计失败")
    if (
        not checks["nearDialogueIdsMatchCurated"]
        or checks["nearDialogueCount"] != 16
        or unsafe_frames
        or floating_frames
    ):
        raise RuntimeError("安全近景或顶部安全区审计失败")
    if checks["maxCastSize"] != 8 or not checks["firstPersonNeverVisible"]:
        raise RuntimeError("舞台人数或第一人称冈部审计失败")
    if (
        checks["sceneBeatCount"] != len(SCENE_BEATS)
        or not checks["sceneBeatsExact"]
        or checks["sceneEventsInsideCgs"]
        or checks["distinctSceneCount"] < 8
    ):
        raise RuntimeError("场景丰富度没有达到验收条件")
    if (
        checks["cameraBeatCount"] < 12
        or not checks["cameraUiIsolationReady"]
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
                        "suzuhaUsesSg0BlueVest",
                    )
                },
                ensure_ascii=False,
            )
        )
    if (
        checks["showCgCount"] != len(CG_SPECS)
        or checks["hideCgCount"] != sum(spec["endMs"] is not None for spec in CG_SPECS)
        or not checks["managedCgDefinitionsReady"]
        or checks["duplicateCgEventIds"]
        or cg_overlaps
        or overlong_story_cgs
        or checks["blockCount"] > 1000
    ):
        raise RuntimeError("CG 事件或 Block 上限审计失败")
    if checks["logicalLibraryCount"] != 701 or missing_mapping or missing_cg_mapping:
        raise RuntimeError("原作素材映射不完整")
    if checks["curtainCount"] or checks["characterFadeBlocks"]:
        raise RuntimeError("普通演出仍包含幕布或人物淡化")
    if annotation_audit is not None:
        if (
            annotation_audit["expectedChangedTextCount"] != EXPECTED_ANNOTATION_TEXT_CHANGES
            or annotation_audit["expectedChangedSpeakerCount"]
            != EXPECTED_ANNOTATION_SPEAKER_CHANGES
            or annotation_audit["multiSpeakerCount"] != EXPECTED_ANNOTATION_MULTI_SPEAKER_LINES
            or dialogue_signature(fragment) != annotation_audit["expectedDialogueSignature"]
        ):
            raise RuntimeError("新版对白标注审计失败")
    return checks


def transform_latest_story(
    latest: dict[str, Any],
    mapping: dict[str, Any],
    source_root: Path,
    annotation_path: Path,
) -> tuple[dict[str, Any], dict[str, Any]]:
    document = deepcopy(latest["document"])
    fragment = target_fragment(document)
    baseline = {
        "revision": latest["revision"],
        "durationMs": fragment["timeline"]["durationMs"],
        "dialogueTimelineSignature": dialogue_timeline_signature(fragment),
    }
    annotation_audit = apply_annotation(document, annotation_path)
    observed_changes = (
        annotation_audit["changedTextCount"],
        annotation_audit["changedSpeakerCount"],
    )
    if observed_changes not in {
        (0, 0),
        (EXPECTED_ANNOTATION_TEXT_CHANGES, EXPECTED_ANNOTATION_SPEAKER_CHANGES),
    }:
        raise RuntimeError(f"新版对白变更数量异常：{observed_changes}")
    install_curated_scenes(document, mapping)
    upgrade_suzuha(document, mapping, source_root)
    set_all_lip_sync_fps(document)
    enlarge_dialogue_text(document)
    first_person_id = first_person_okabe(document)["id"]
    install_performance_blocks(document, first_person_id)
    install_cgs(document, mapping)
    checks = audit_document(document, mapping, source_root, annotation_audit)
    if (
        dialogue_timeline_signature(target_fragment(document))
        != baseline["dialogueTimelineSignature"]
    ):
        raise RuntimeError("最终审计发现对白 Block、时间或音频绑定发生变化")
    return document, {"baseline": baseline, "checks": checks}


def apply_story(
    client: httpx.Client,
    project_id: str,
    mapping: dict[str, Any],
    source_root: Path,
    annotation_path: Path,
) -> dict[str, Any]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", project_path(project_id, "/story"))
        backup_path = BACKUP_ROOT / f"{timestamp()}-performance-before.json"
        write_json(backup_path, latest)
        document, audit = transform_latest_story(latest, mapping, source_root, annotation_path)
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
    annotation_path: Path,
) -> dict[str, Any]:
    story = request_json(client, "GET", project_path(project_id, "/story"))
    listed = request_json(client, "GET", project_path(project_id, "/assets"))["items"]
    existing_ids = {asset["id"] for asset in listed}
    missing_assets = [
        relative
        for relative, item in mapping.get("items", {}).items()
        if item["assetId"] not in existing_ids
    ]
    document = deepcopy(story["document"])
    annotation_audit = apply_annotation(document, annotation_path)
    if dialogue_signature(target_fragment(document)) != dialogue_signature(
        target_fragment(story["document"])
    ):
        raise RuntimeError("线上故事尚未与新版对白标注完全一致")
    checks = audit_document(story["document"], mapping, source_root, annotation_audit)
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
    if not args.annotation.is_file():
        raise RuntimeError(f"新版对白标注不存在：{args.annotation}")
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
            apply_story(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.annotation,
            )
        if args.action in {"audit", "all"}:
            audit_live(
                client,
                args.project_id,
                mapping,
                args.source_root,
                args.annotation,
            )


if __name__ == "__main__":
    main()
