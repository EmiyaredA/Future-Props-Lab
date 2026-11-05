"""Compatibility for clients editing a single prompt through the canvas API."""

from studio.apps.visual_workshop.schemas.workshop import VisualCanvasNode


def preserve_legacy_prompt_versions(
    nodes: list[VisualCanvasNode], current_nodes: list[dict]
) -> None:
    current = {node["id"]: node for node in current_nodes}
    for node in nodes:
        if node.kind == "text" or node.generation_draft is None:
            continue
        draft = node.generation_draft
        if "prompt_versions" in draft.model_fields_set:
            continue
        stored = current.get(node.id, {}).get("generation_draft") or {}
        versions = stored.get("prompt_versions")
        active = stored.get("active_prompt_version_id")
        if not versions or not active:
            continue
        data = draft.model_dump(mode="json")
        data["prompt_versions"] = [
            {**version, "prompt": draft.prompt} if version["id"] == active else dict(version)
            for version in versions
        ]
        data["active_prompt_version_id"] = active
        node.generation_draft = type(draft).model_validate(data)
