from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx

try:
    from scripts.management_api import management_api_key
except ModuleNotFoundError:
    from management_api import management_api_key

REPO_ROOT = Path(__file__).resolve().parents[3]
BACKUP_ROOT = REPO_ROOT / ".runtime" / "galgame-import-backups"


def request_json(
    client: httpx.Client,
    method: str,
    path: str,
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    response = client.request(method, path, json=payload)
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:
        raise RuntimeError(
            f"API {method} {path} 返回 {response.status_code}: {response.text}"
        ) from exc
    return response.json()


def emotion_by_interval(story_document: dict[str, Any]) -> dict[tuple[int, int], str]:
    characters = {character["id"]: character for character in story_document["characters"]}
    expression_labels = {
        (character["id"], expression["id"]): expression.get("label") or expression["id"]
        for character in story_document["characters"]
        for expression in character.get("expressions", [])
    }
    result: dict[tuple[int, int], str] = {}
    for chapter in story_document.get("chapters", []):
        for fragment in chapter.get("fragments", []):
            for block in fragment.get("blocks", []):
                if block.get("type") != "dialogue" or not block.get("expressionId"):
                    continue
                character_id = block.get("characterId")
                if character_id not in characters:
                    continue
                label = expression_labels.get((character_id, block["expressionId"]))
                if label:
                    result[(block["startMs"], block["endMs"])] = label
    return result


def build_synced_document(
    current: dict[str, Any], story_document: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, int]]:
    speakers = deepcopy(current["speakers"])
    emotions = emotion_by_interval(story_document)
    segments = deepcopy(current["segments"])
    emotion_count = 0
    changed_count = 0
    for segment in segments:
        emotion = emotions.get((segment["start_ms"], segment["end_ms"]))
        if segment.get("emotion") != emotion:
            changed_count += 1
        segment["emotion"] = emotion
        if emotion:
            emotion_count += 1
    return (
        {"schema_version": "1.0", "speakers": speakers, "segments": segments},
        {
            "emotionChangedCount": changed_count,
            "emotionTaggedCount": emotion_count,
            "speakerPreservedCount": len(segments),
        },
    )


def story_character_map(
    story_document: dict[str, Any], audio_document: dict[str, Any]
) -> dict[str, str]:
    characters_by_name: dict[str, list[str]] = {}
    for character in story_document.get("characters", []):
        characters_by_name.setdefault(character["name"], []).append(character["id"])
    aliases = {
        "菲莉丝·喵喵": ("菲莉丝·喵喵", "菲莉丝"),
        "幼年篝": ("幼年篝", "冈部篝"),
    }
    mapping: dict[str, str] = {}
    for speaker in audio_document.get("speakers", []):
        names = aliases.get(speaker["name"], (speaker["name"],))
        candidates = [
            character_id for name in names for character_id in characters_by_name.get(name, [])
        ]
        if len(candidates) != 1:
            raise RuntimeError(
                f"广播说话人 {speaker['name']} 应唯一对应 Galgame 角色，实际为 {len(candidates)} 个"
            )
        mapping[speaker["id"]] = candidates[0]
    return mapping


def sync_story_speakers(
    story_document: dict[str, Any], audio_document: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    document = deepcopy(story_document)
    dialogues: dict[tuple[int, int], dict[str, Any]] = {}
    blocks_by_id: dict[str, dict[str, Any]] = {}
    for chapter in document.get("chapters", []):
        for fragment in chapter.get("fragments", []):
            for block in fragment.get("blocks", []):
                if block.get("id"):
                    blocks_by_id[block["id"]] = block
                if block.get("type") != "dialogue":
                    continue
                interval = (block["startMs"], block["endMs"])
                if interval in dialogues:
                    raise RuntimeError(f"Galgame 对白时间区间重复：{interval}")
                dialogues[interval] = block
    character_map = story_character_map(document, audio_document)
    characters = {character["id"]: character for character in document["characters"]}
    changes: list[dict[str, Any]] = []
    stage_changes: list[dict[str, Any]] = []
    for index, segment in enumerate(audio_document.get("segments", [])):
        interval = (segment["start_ms"], segment["end_ms"])
        dialogue = dialogues.get(interval)
        if dialogue is None:
            raise RuntimeError(f"广播片段无法按时间对齐 Galgame：{interval}")
        character_id = character_map[segment["speaker_id"]]
        speaker_ids = [character_map[speaker_id] for speaker_id in segment["speaker_ids"]]
        expression_id = dialogue.get("expressionId")
        if expression_id and expression_id not in {
            expression["id"] for expression in characters[character_id].get("expressions", [])
        }:
            raise RuntimeError(
                f"片段 {index + 1} 切换为 {characters[character_id]['name']} 后，"
                f"表情 {expression_id} 不属于该角色"
            )
        before = (dialogue.get("characterId"), tuple(dialogue.get("speakerIds") or []))
        after = (character_id, tuple(speaker_ids))
        if before != after:
            changes.append(
                {
                    "segment": index + 1,
                    "blockId": dialogue["id"],
                    "startMs": segment["start_ms"],
                    "beforeCharacterId": before[0],
                    "afterCharacterId": after[0],
                }
            )
            dialogue["characterId"] = character_id
            dialogue["speakerIds"] = speaker_ids

        current_cast = blocks_by_id.get(f"perf-cast-{index}")
        members = current_cast.get("members", []) if current_cast else []
        if not members or members[0].get("characterId") == character_id:
            continue
        old_character_id = members[0].get("characterId")
        members[0]["characterId"] = character_id
        members[0]["expressionId"] = expression_id
        stage_changes.append(
            {
                "segment": index + 1,
                "blockId": current_cast["id"],
                "memberIndex": 0,
                "beforeCharacterId": old_character_id,
                "afterCharacterId": character_id,
            }
        )
        next_cast = blocks_by_id.get(f"perf-cast-{index + 1}")
        for member_index, member in enumerate(next_cast.get("members", []) if next_cast else []):
            if member.get("characterId") != old_character_id:
                continue
            member["characterId"] = character_id
            member["expressionId"] = expression_id
            stage_changes.append(
                {
                    "segment": index + 2,
                    "blockId": next_cast["id"],
                    "memberIndex": member_index,
                    "beforeCharacterId": old_character_id,
                    "afterCharacterId": character_id,
                }
            )
    return document, {
        "speakerChangedCount": len(changes),
        "speakerChanges": changes,
        "stageCastChangedCount": len(stage_changes),
        "stageCastChanges": stage_changes,
    }


def write_backup(name: str, value: dict[str, Any]) -> Path:
    BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")
    path = BACKUP_ROOT / f"{stamp}-{name}.json"
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return path


def apply_story_speakers(
    client: httpx.Client, project_id: str, audio_document: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, Any]]:
    for attempt in range(1, 4):
        latest = request_json(client, "GET", f"/v1/galgame-workshop/projects/{project_id}/story")
        document, audit = sync_story_speakers(latest["document"], audio_document)
        if audit["speakerChangedCount"] == 0 and audit["stageCastChangedCount"] == 0:
            audit["beforeRevision"] = latest["revision"]
            audit["savedRevision"] = latest["revision"]
            audit["backup"] = None
            return latest, audit
        backup = write_backup("story-before-annotation-speaker-sync", latest)
        response = client.put(
            f"/v1/galgame-workshop/projects/{project_id}/story",
            json={"expected_revision": latest["revision"], "document": document},
        )
        if response.status_code == 409 and attempt < 3:
            continue
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"API PUT Galgame Story 返回 {response.status_code}: {response.text}"
            ) from exc
        saved = response.json()
        audit["beforeRevision"] = latest["revision"]
        audit["savedRevision"] = saved["revision"]
        audit["backup"] = str(backup)
        return saved, audit
    raise RuntimeError("Galgame Story 连续三次 revision 冲突")


def apply_audio_emotions(
    client: httpx.Client,
    audio_project_id: str,
    story_document: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    for attempt in range(1, 4):
        current = request_json(
            client, "GET", f"/v1/audio-annotation/projects/{audio_project_id}/document"
        )
        document, audit = build_synced_document(current, story_document)
        if audit["emotionChangedCount"] == 0:
            audit["beforeRevision"] = current["revision"]
            audit["savedRevision"] = current["revision"]
            audit["backup"] = None
            return current, audit
        backup = write_backup("annotation-before-expression-sync", current)
        response = client.put(
            f"/v1/audio-annotation/projects/{audio_project_id}/document",
            json={"expected_revision": current["revision"], **document},
        )
        if response.status_code == 409 and attempt < 3:
            continue
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise RuntimeError(
                f"API PUT Audio Annotation 返回 {response.status_code}: {response.text}"
            ) from exc
        saved = response.json()
        audit["beforeRevision"] = current["revision"]
        audit["savedRevision"] = saved["revision"]
        audit["backup"] = str(backup)
        return saved, audit
    raise RuntimeError("广播标注连续三次 revision 冲突")


def export_annotation(path: Path, project: dict[str, Any], document: dict[str, Any]) -> None:
    value = {
        "kind": "future-props-audio-annotation",
        "schema_version": "1.0",
        "exported_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "project": {
            "title": project["title"],
            "duration_ms": project["duration_ms"],
            "source": {
                "asset_id": project["asset_id"],
                "display_name": project["asset_display_name"],
                "original_filename": project["original_filename"],
                "mime_type": project["mime_type"],
                "byte_size": project["byte_size"],
            },
        },
        "speakers": document["speakers"],
        "segments": sorted(document["segments"], key=lambda item: item["start_ms"]),
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def matching_audio_project(client: httpx.Client, annotation: dict[str, Any]) -> dict[str, Any]:
    project_meta = annotation["project"]
    source = project_meta["source"]
    items = request_json(client, "GET", "/v1/audio-annotation/projects")["items"]
    matches = [
        item
        for item in items
        if item["title"] == project_meta["title"]
        and item["asset_id"] == source["asset_id"]
        and item["segment_count"] == len(annotation["segments"])
    ]
    if len(matches) != 1:
        raise RuntimeError(f"应唯一找到广播剧标注任务，实际为 {len(matches)} 个")
    return matches[0]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="保留在线广播标注并通过正式 API 同步 Galgame 角色与表情"
    )
    parser.add_argument("--annotation", type=Path, required=True)
    parser.add_argument("--export", type=Path, required=True)
    parser.add_argument("--galgame-project-id", required=True)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    annotation = json.loads(args.annotation.read_text(encoding="utf-8"))
    management_key = management_api_key()
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        audio_project = matching_audio_project(client, annotation)
        current = request_json(
            client,
            "GET",
            f"/v1/audio-annotation/projects/{audio_project['id']}/document",
        )
        saved_story, story_audit = apply_story_speakers(client, args.galgame_project_id, current)
        saved, emotion_audit = apply_audio_emotions(
            client, audio_project["id"], saved_story["document"]
        )
        export_annotation(args.export, audio_project, saved)
        print(
            json.dumps(
                {
                    "projectId": audio_project["id"],
                    "audioRevision": saved["revision"],
                    "storyRevision": saved_story["revision"],
                    "export": str(args.export),
                    "story": story_audit,
                    "emotions": emotion_audit,
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
