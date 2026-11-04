"""Portable Visual snapshot references independent of storage."""


def canvas_asset_ids(nodes: list[dict]) -> set[str]:
    result: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            continue
        if node.get("asset_id"):
            result.add(str(node["asset_id"]))
        draft = node.get("generation_draft")
        if not isinstance(draft, dict):
            continue
        for key in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id"):
            if draft.get(key):
                result.add(str(draft[key]))
        for key in ("reference_asset_ids", "audio_asset_ids", "video_asset_ids"):
            values = draft.get(key)
            if isinstance(values, list):
                result.update(str(value) for value in values if value)
    return result
