"""Pure material substitutions: never collapse slots or reinterpret prompt text."""

from copy import deepcopy


class UnsafeMerge(ValueError):
    pass


def unique_map(values, mapping):
    result = [mapping.get(value, value) for value in values or []]
    if len(result) != len(set(result)):
        raise UnsafeMerge("duplicate_input_slots")
    return result


def keyed(values, mapping, *, prefixed=False):
    result = {}
    for key, value in (values or {}).items():
        target = (
            f"asset:{mapping.get(key[6:], key[6:])}"
            if prefixed and key.startswith("asset:")
            else mapping.get(key, key)
        )
        if target in result and result[target] != value:
            raise UnsafeMerge("conflicting_reference_bindings")
        result[target] = value
    return result


def remap_draft(draft, mapping, card_revisions):
    result = deepcopy(draft)
    for field in ("reference_asset_id", "first_frame_asset_id", "last_frame_asset_id"):
        if result.get(field) in mapping:
            result[field] = mapping[result[field]]
    for field in ("reference_asset_ids", "video_asset_ids", "audio_asset_ids"):
        if field in result:
            result[field] = unique_map(result[field], mapping)
    if (
        result.get("first_frame_asset_id")
        and result.get("last_frame_asset_id")
        and (
            draft.get("first_frame_asset_id") != draft.get("last_frame_asset_id")
            and result["first_frame_asset_id"] == result["last_frame_asset_id"]
        )
    ):
        raise UnsafeMerge("distinct_frame_slots")
    if "reference_subjects" in result:
        result["reference_subjects"] = keyed(result["reference_subjects"], mapping, prefixed=True)
    if "prompt_reference_names" in result:
        result["prompt_reference_names"] = keyed(result["prompt_reference_names"], mapping)
    if "reference_order" in result:
        result["reference_order"] = unique_map(
            result["reference_order"],
            {f"asset:{old}": f"asset:{new}" for old, new in mapping.items()},
        )
    if "design_references" in result:
        refs = result["design_references"] or []
        for ref in refs:
            if ref["asset_id"] in mapping:
                ref["asset_id"] = mapping[ref["asset_id"]]
            if ref["card_id"] in card_revisions:
                ref["card_revision"] = card_revisions[ref["card_id"]]
        if len({ref["asset_id"] for ref in refs}) != len(refs):
            raise UnsafeMerge("distinct_design_references")
    return result


def remap_canvas(canvas, mapping, card_revisions):
    result = deepcopy(canvas)
    for node in result.get("nodes", []):
        if node.get("asset_id") in mapping:
            node["asset_id"] = mapping[node["asset_id"]]
        if node.get("design_card_id") in card_revisions:
            node["design_card_revision"] = card_revisions[node["design_card_id"]]
        if node.get("generation_draft"):
            node["generation_draft"] = remap_draft(
                node["generation_draft"], mapping, card_revisions
            )
    return result


def remap_card(card, mapping):
    result = deepcopy(card)
    for field in ("adopted_asset_id", "parent_asset_id", "voice_asset_id"):
        if result.get(field) in mapping:
            result[field] = mapping[result[field]]
    if "candidate_asset_ids" in result:
        # Candidate history is meaningful even when the original bytes match.
        result["candidate_asset_ids"] = unique_map(result["candidate_asset_ids"], mapping)
    if (key := result.get("model_asset_key")) and key.startswith("asset:"):
        result["model_asset_key"] = f"asset:{mapping.get(key[6:], key[6:])}"
    return result


def canvas_body(canvas, revision):
    return {
        "expected_revision": revision,
        **{
            key: canvas[key]
            for key in ("nodes", "edges", "groups", "categories", "project_card_ids")
            if key in canvas
        },
    }


def card_body(card, revision):
    return {
        "expected_revision": revision,
        **{
            key: value
            for key, value in card.items()
            if key not in {"id", "revision", "source_project_id", "media_projects"}
        },
    }
