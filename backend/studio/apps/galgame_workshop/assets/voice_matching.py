"""Match retained voice transcripts and dialogue by their published scoring rules."""

import re
import unicodedata
from difflib import SequenceMatcher

from studio.apps.galgame_workshop.assets.asset_support import ProjectAssetFile
from studio.apps.galgame_workshop.schemas import GalgameVoiceMatchItem


def match_dialogue(document, voice_rows, body):
    payload = document.model_dump(mode="json", by_alias=True)
    dialogue_blocks: list[tuple[dict[str, object], str]] = []
    for chapter in payload["chapters"]:
        for fragment in chapter["fragments"]:
            for block in fragment["blocks"]:
                if block.get("type") == "dialogue" and str(block.get("text", "")).strip():
                    dialogue_blocks.append((block, str(block["text"])))
    story_asset_by_file = {
        asset["fileId"]: asset for asset in payload["assets"] if asset["type"] == "audio"
    }
    requested_block_ids = set(body.block_ids) if body.block_ids is not None else None
    candidates: list[tuple[float, str, str, dict[str, object], ProjectAssetFile]] = []
    for asset, metadata in voice_rows:
        normalized_transcript = _normalized_text(metadata.transcript or "")
        if not normalized_transcript:
            continue
        for block, text in dialogue_blocks:
            if requested_block_ids is not None and str(block["id"]) not in requested_block_ids:
                continue
            similarity = SequenceMatcher(
                None, normalized_transcript, _normalized_text(text)
            ).ratio()
            if similarity >= body.minimum_similarity:
                candidates.append(
                    (-similarity, asset.display_name.casefold(), str(block["id"]), block, asset)
                )
    candidates.sort(key=lambda item: (item[0], item[1], item[2]))
    used_assets: set[str] = set()
    used_blocks: set[str] = set()
    matches: list[GalgameVoiceMatchItem] = []
    for negative_similarity, _filename, block_id, block, asset in candidates:
        if asset.id in used_assets or block_id in used_blocks:
            continue
        story_asset = story_asset_by_file.get(asset.id)
        if story_asset is None:
            story_asset = {
                "id": f"voice-{asset.id}",
                "type": "audio",
                "role": "voiceLine",
                "label": asset.display_name,
                "fileId": asset.id,
                "status": "ready",
            }
            payload["assets"].append(story_asset)
            story_asset_by_file[asset.id] = story_asset
        elif story_asset.get("role") != "voiceLine":
            continue
        block["voiceAssetId"] = story_asset["id"]
        used_assets.add(asset.id)
        used_blocks.add(block_id)
        matches.append(
            GalgameVoiceMatchItem(
                assetId=asset.id,
                blockId=block_id,
                similarity=round(-negative_similarity, 6),
            )
        )
    return payload, matches, [asset.id for asset, _ in voice_rows if asset.id not in used_assets]


def _normalized_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).casefold()
    return re.sub(r"[\W_]+", "", normalized, flags=re.UNICODE)
