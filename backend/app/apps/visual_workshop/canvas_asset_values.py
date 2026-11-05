"""Extract the material IDs that a Canvas node can use."""

from app.apps.visual_workshop.schemas.workshop import VisualCanvasNode


def expected_assets(nodes: list[VisualCanvasNode]) -> list[tuple[str, str]]:
    expected: list[tuple[str, str]] = []
    for node in nodes:
        if node.kind != "text" and node.asset_id is not None:
            expected.append((node.asset_id, node.kind))
        if node.kind == "image" and node.generation_draft:
            expected.extend(
                (asset_id, "image") for asset_id in node.generation_draft.reference_asset_ids
            )
            if node.generation_draft.reference_asset_id:
                expected.append((node.generation_draft.reference_asset_id, "image"))
        if node.kind == "video" and node.generation_draft:
            draft = node.generation_draft
            expected.extend(
                (asset_id, "image")
                for asset_id in (
                    draft.first_frame_asset_id,
                    draft.last_frame_asset_id,
                    *draft.reference_asset_ids,
                )
                if asset_id
            )
            expected.extend((asset_id, "audio") for asset_id in draft.audio_asset_ids)
            expected.extend((asset_id, "video") for asset_id in draft.video_asset_ids)
        if node.kind == "audio" and node.generation_draft:
            expected.extend(
                (asset_id, "audio") for asset_id in node.generation_draft.reference_asset_ids
            )
    return expected


def existing_assets(current_nodes: list[dict]) -> set[str]:
    existing_asset_ids: set[str] = set()
    for node in current_nodes:
        if node.get("asset_id"):
            existing_asset_ids.add(node["asset_id"])
        draft = node.get("generation_draft") or {}
        if node.get("kind") == "image" and draft.get("reference_asset_id"):
            existing_asset_ids.add(draft["reference_asset_id"])
        if node.get("kind") == "image":
            existing_asset_ids.update(draft.get("reference_asset_ids") or [])
        if node.get("kind") == "video":
            existing_asset_ids.update(
                asset_id
                for asset_id in (
                    draft.get("first_frame_asset_id"),
                    draft.get("last_frame_asset_id"),
                    *(draft.get("reference_asset_ids") or []),
                    *(draft.get("audio_asset_ids") or []),
                    *(draft.get("video_asset_ids") or []),
                )
                if asset_id
            )
        if node.get("kind") == "audio":
            existing_asset_ids.update(draft.get("reference_asset_ids") or [])
    return existing_asset_ids
