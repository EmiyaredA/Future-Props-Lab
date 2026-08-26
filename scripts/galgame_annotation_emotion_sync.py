from __future__ import annotations

import argparse
import json
from copy import deepcopy
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from dotenv import dotenv_values

REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ANNOTATION_PATH = Path("/Users/tonghao/Downloads/广播剧.annotation (14).json")
DEFAULT_GALGAME_PROJECT_ID = "63ac832d-bff3-4053-9c9f-f55c9dafc52a"
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
    annotation: dict[str, Any], story_document: dict[str, Any]
) -> tuple[dict[str, Any], dict[str, int]]:
    speakers = deepcopy(annotation["speakers"])
    crowd_id = next(speaker["id"] for speaker in speakers if speaker["name"] == "众人")
    emotions = emotion_by_interval(story_document)
    segments = deepcopy(annotation["segments"])
    crowd_count = 0
    emotion_count = 0
    for segment in segments:
        if len(segment.get("speaker_ids") or []) > 3:
            segment["speaker_id"] = crowd_id
            segment["speaker_ids"] = [crowd_id]
            crowd_count += 1
        emotion = emotions.get((segment["start_ms"], segment["end_ms"]))
        segment["emotion"] = emotion
        if emotion:
            emotion_count += 1
    return (
        {"schema_version": "1.0", "speakers": speakers, "segments": segments},
        {"crowdNormalizedCount": crowd_count, "emotionTaggedCount": emotion_count},
    )


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
    parser = argparse.ArgumentParser(description="通过正式 API 回填广播剧表情情绪与众人标签")
    parser.add_argument("--annotation", type=Path, default=DEFAULT_ANNOTATION_PATH)
    parser.add_argument("--galgame-project-id", default=DEFAULT_GALGAME_PROJECT_ID)
    parser.add_argument("--base-url", default="http://127.0.0.1:9000")
    args = parser.parse_args()
    annotation = json.loads(args.annotation.read_text(encoding="utf-8"))
    management_key = (
        dotenv_values(REPO_ROOT / "backend" / ".env").get("FPL_MANAGEMENT_API_KEY") or ""
    ).strip()
    if not management_key.startswith("fpm_"):
        raise RuntimeError("backend/.env 未配置可用的 FPL_MANAGEMENT_API_KEY")
    with httpx.Client(
        base_url=args.base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {management_key}"},
        timeout=None,
    ) as client:
        story = request_json(
            client,
            "GET",
            f"/v1/galgame-workshop/projects/{args.galgame_project_id}/story",
        )
        audio_project = matching_audio_project(client, annotation)
        current = request_json(
            client,
            "GET",
            f"/v1/audio-annotation/projects/{audio_project['id']}/document",
        )
        BACKUP_ROOT.mkdir(parents=True, exist_ok=True)
        timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H-%M-%S.%fZ")
        backup = BACKUP_ROOT / f"{timestamp}-annotation-before.json"
        backup.write_text(
            json.dumps(current, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        document, audit = build_synced_document(annotation, story["document"])
        saved = request_json(
            client,
            "PUT",
            f"/v1/audio-annotation/projects/{audio_project['id']}/document",
            {"expected_revision": current["revision"], **document},
        )
        print(
            json.dumps(
                {
                    "projectId": audio_project["id"],
                    "savedRevision": saved["revision"],
                    "storyRevision": story["revision"],
                    "backup": str(backup),
                    **audit,
                },
                ensure_ascii=False,
            )
        )


if __name__ == "__main__":
    main()
