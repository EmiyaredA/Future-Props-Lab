"""Estimate route timing consistently in Galgame preflight and Rendering."""

from typing import Any

COMPILER_VERSION = "galgame-render-plan-v3"


def _content_text(block: dict[str, Any]) -> str:
    if isinstance(block.get("text"), str):
        return block["text"]
    content = block.get("content")
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        return str(content.get("text", ""))
    return ""


def estimate_block_ms(block: dict[str, Any], asset_duration: dict[str, int]) -> tuple[int, bool]:
    block_type = block.get("type")
    if block_type in {"dialogue", "narration", "storyParagraph", "floatingText"}:
        voice_id = block.get("voiceAssetId")
        if voice_id and voice_id in asset_duration:
            return asset_duration[voice_id] + 400, False
        speed = max(1, int(block.get("textSpeedCps") or 40))
        return max(400, round(len(_content_text(block)) / speed * 1000) + 400), False
    if block_type == "wait":
        if block.get("mode") == "player":
            return 1200, False
        return max(0, int(block.get("durationMs", 0))), True
    if block_type == "systemMessage":
        return 1200, False
    if block.get("waitForCompletion") and isinstance(block.get("durationMs"), int):
        return max(0, block["durationMs"]), True
    return 0, True
