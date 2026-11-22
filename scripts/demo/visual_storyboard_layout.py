"""Arrange an explicitly curated project's existing nodes into shot groups.

Uses the public Canvas API; changes positions and visual groups only. Single-node
shots are laid out as independent units because canvas groups require two nodes.
"""

from __future__ import annotations

import argparse
import json
import math
from collections import defaultdict
from copy import deepcopy
from pathlib import Path
from uuid import UUID, uuid5

import httpx
from future_props_lab import ApiError
from future_props_lab.website import website_client
from scripts.demo.visual_storyboard_curate import (
    canvas_digest,
    check_account,
    dump,
    same_shots,
    target_shots,
    validate_entry,
    write_json,
)

# Match the workbench's canvas/geometry.ts; includes the node heading and ports.
NODE_SIZE = {"text": (300, 180), "image": (320, 214), "video": (320, 214), "audio": (300, 132)}
GAP_X, GAP_Y = 48, 56
SHELF_WIDTH, SECTION_GAP = 5600, 420


def stable_group_id(project_id, key):
    return str(uuid5(UUID(project_id), "curated-canvas-group:" + key))


def canvas_content(canvas):
    """Everything except grouping, positions and the canvas CAS envelope."""
    result = deepcopy(canvas)
    for key in ("groups", "revision", "updated_at"):
        result.pop(key, None)
    for node in result["nodes"]:
        node.pop("position", None)
    return result


def presentation(canvas):
    return {
        "groups": canvas.get("groups", []),
        "positions": {node["id"]: node["position"] for node in canvas["nodes"]},
    }


def reference_bucket(node, categories):
    category = categories.get(node.get("category_id"), "")
    if category in {"人设", "角色", "角色卡"} or node.get("category_id") in {
        "character",
        "characters",
    }:
        return "共用人设"
    if category in {"场景", "场景卡"} or node.get("category_id") == "scene":
        return "共用场景"
    if node["kind"] == "audio":
        return "共用音频与声音参考"
    if node["kind"] == "text":
        return "制作总览与说明"
    if node["kind"] == "video":
        return "原片、合集与动作参考"
    return "其他制作参考"


def layout_canvas(canvas, entry):
    """Create non-overlapping shot units while preserving every node and edge."""
    validate_entry(entry, canvas)
    result = deepcopy(canvas)
    nodes = {node["id"]: node for node in result["nodes"]}
    source = {node["id"]: node for node in canvas["nodes"]}
    records = entry["records"]
    units = []
    owner = {}
    for record in records:
        members = list(record["node_ids"])
        primary = [
            record["shot"].get("image_node_id"),
            record["shot"].get("video_node_id"),
        ]
        primary = [identity for identity in primary if identity]
        ordered = list(dict.fromkeys(primary + members))
        unit = {
            "key": record["key"],
            "title": record["shot"]["title"],
            "historical": record.get("historical", False),
            "members": ordered,
        }
        units.append(unit)
        for identity in members:
            owner[identity] = len(units) - 1

    # Only uniquely attributable notes/audio join shots. Shared voices, music and
    # instructions remain references, and are never duplicated across groups.
    legacy = defaultdict(set)
    for identity, unit in owner.items():
        node = source[identity]
        if node.get("group"):
            legacy[node.get("category_id"), node["group"]].add(unit)
    for node in result["nodes"]:
        if node["id"] in owner or node["kind"] not in {"text", "audio"}:
            continue
        candidates = legacy.get((node.get("category_id"), node.get("group")), set())
        if len(candidates) != 1:
            candidates = {
                owner[edge["target_node_id"]]
                for edge in canvas["edges"]
                if edge["source_node_id"] == node["id"] and edge["target_node_id"] in owner
            }
        if len(candidates) == 1:
            unit = next(iter(candidates))
            units[unit]["members"].append(node["id"])
            owner[node["id"]] = unit

    categories = {item["id"]: item["name"] for item in canvas.get("categories", [])}
    references = defaultdict(list)
    for node in result["nodes"]:
        if node["id"] not in owner:
            references[reference_bucket(node, categories)].append(node["id"])

    groups = []
    rectangles = []

    def place(unit, x, y):
        members = unit["members"]
        columns = min(6, math.ceil(math.sqrt(len(members))))
        max_width = max(NODE_SIZE[nodes[identity]["kind"]][0] for identity in members)
        max_height = max(NODE_SIZE[nodes[identity]["kind"]][1] for identity in members)
        for index, identity in enumerate(members):
            nodes[identity]["position"] = {
                "x": x + 20 + (index % columns) * (max_width + GAP_X),
                "y": y + 45 + (index // columns) * (max_height + GAP_Y),
            }
        width = columns * max_width + (columns - 1) * GAP_X + 40
        rows = math.ceil(len(members) / columns)
        height = rows * max_height + (rows - 1) * GAP_Y + 65
        rectangles.append({"key": unit["key"], "x": x, "y": y, "width": width, "height": height})
        if len(members) >= 2:
            groups.append(
                {
                    "id": stable_group_id(canvas["project_id"], unit["key"]),
                    "title": unit["title"][:120],
                    "node_ids": members,
                }
            )
        return width, height

    def pack(section, top):
        x, y, row_height = 80, top, 0
        for unit in section:
            columns = min(6, math.ceil(math.sqrt(len(unit["members"]))))
            estimated_width = columns * 320 + (columns - 1) * GAP_X + 40
            if x > 80 and x + estimated_width > SHELF_WIDTH:
                x, y, row_height = 80, y + row_height + 120, 0
            width, height = place(unit, x, y)
            x += width + 120
            row_height = max(row_height, height)
        return y + row_height

    bottom = pack([unit for unit in units if not unit["historical"]], 80)
    pack([unit for unit in units if unit["historical"]], bottom + SECTION_GAP)
    # Shared materials occupy their own column, outside every shot rectangle.
    reference_y = 80
    for title, members in references.items():
        _, height = place(
            {"key": "references/" + title, "title": title, "members": members},
            -2500,
            reference_y,
        )
        reference_y += height + 160
    result["groups"] = groups
    if len(groups) > 500:
        raise ValueError("Canvas group limit exceeded")
    for node in result["nodes"]:
        if any(abs(value) > 1_000_000 for value in node["position"].values()):
            raise ValueError("Canvas coordinate limit exceeded")
    assert canvas_content(result) == canvas_content(canvas)
    return result, {
        "shot_units": len(units),
        "shot_groups": sum(len(unit["members"]) >= 2 for unit in units),
        "single_node_shots": sum(len(unit["members"]) == 1 for unit in units),
        "groups": len(groups),
        "nodes": len(nodes),
        "rectangles": rectangles,
    }


def prepare(client, storyboard_manifest):
    check_account(client, storyboard_manifest)
    entries = []
    for entry in storyboard_manifest["projects"]:
        project_id = entry["project_id"]
        board = dump(client.visual.get_storyboard(project_id=project_id))
        if not same_shots(board, target_shots(entry)):
            raise ValueError(f"Storyboard changed; review grouping again: {project_id}")
        before = dump(client.visual.get_canvas(project_id=project_id))
        after, stats = layout_canvas(before, entry)
        entries.append(
            {
                "project_id": project_id,
                "title": entry["title"],
                "storyboard": board,
                "before": before,
                "after": after,
                "stats": stats,
            }
        )
    return {"user_id": storyboard_manifest["user_id"], "projects": entries}


def validate_layout_entry(entry):
    before, after = entry["before"], entry["after"]
    if before["project_id"] != entry["project_id"] or after["project_id"] != entry["project_id"]:
        raise ValueError("Wrong project in canvas layout")
    if canvas_content(before) != canvas_content(after):
        raise ValueError("Layout may change only node positions and visual groups")
    ids = {node["id"] for node in before["nodes"]}
    groups = after["groups"]
    group_ids = [group["id"] for group in groups]
    members = [identity for group in groups for identity in group["node_ids"]]
    if len(ids) != len(before["nodes"]) or len(groups) > 500:
        raise ValueError("Invalid canvas/group count")
    if len(group_ids) != len(set(group_ids)) or set(group_ids) & ids:
        raise ValueError("Duplicate group identity")
    if len(members) != len(set(members)) or set(members) - ids:
        raise ValueError("Invalid or shared group members")
    if any(not 2 <= len(group["node_ids"]) <= 1000 for group in groups):
        raise ValueError("Canvas groups need at least two nodes")
    for node in after["nodes"]:
        coordinates = node["position"]
        if set(coordinates) != {"x", "y"} or any(
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or abs(value) > 1_000_000
            for value in coordinates.values()
        ):
            raise ValueError("Invalid canvas coordinates")


def current_for_entry(client, entry):
    validate_layout_entry(entry)
    project_id = entry["project_id"]
    board = dump(client.visual.get_storyboard(project_id=project_id))
    if board != entry["storyboard"]:
        raise ValueError(f"Storyboard changed: {project_id}")
    current = dump(client.visual.get_canvas(project_id=project_id))
    complete = canvas_content(current) == canvas_content(entry["after"]) and presentation(
        current
    ) == presentation(entry["after"])
    if not complete and canvas_digest(current) != canvas_digest(entry["before"]):
        raise ValueError(f"Canvas changed; preserve concurrent edits: {project_id}")
    return current, complete


def apply_layout(client, manifest, backup_dir, on_result=lambda _value: None):
    check_account(client, manifest)
    for entry in manifest["projects"]:
        current_for_entry(client, entry)
    results = []
    for entry in manifest["projects"]:
        project_id = entry["project_id"]
        current, complete = current_for_entry(client, entry)
        if complete:
            result = {
                "project_id": project_id,
                "status": "unchanged",
                "revision": current["revision"],
            }
        else:
            backup = backup_dir / f"{project_id}-canvas-r{current['revision']}.json"
            try:
                write_json(backup, current, exclusive=True)
            except FileExistsError:
                if json.loads(backup.read_text()) != current:
                    raise ValueError("Canvas recovery point collision") from None
            target = entry["after"]
            body = {
                "expected_revision": current["revision"],
                "nodes": target["nodes"],
                "edges": target["edges"],
                "groups": target["groups"],
            }
            try:
                client.visual.put_canvas(project_id=project_id, body=body)
            except (ApiError, httpx.TransportError):
                _, confirmed = current_for_entry(client, entry)
                if not confirmed:
                    raise
            saved, confirmed = current_for_entry(client, entry)
            if not confirmed:
                raise ValueError(f"Layout read-back mismatch: {project_id}")
            result = {
                "project_id": project_id,
                "status": "saved",
                "revision": saved["revision"],
                "backup": str(backup.resolve()),
            }
        results.append(result)
        on_result(results)
    return results


def verify_layout(client, manifest):
    check_account(client, manifest)
    results = []
    for entry in manifest["projects"]:
        current, complete = current_for_entry(client, entry)
        results.append(
            {
                "project_id": entry["project_id"],
                "verified": complete,
                "groups": len(current["groups"]),
                "nodes": len(current["nodes"]),
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--profile", default="default")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("prepare", "apply", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--manifest", type=Path, required=True)
        command.add_argument("--output", type=Path, required=True)
        if name == "apply":
            command.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "apply" and not args.backup_dir.resolve().is_relative_to(
        Path(__file__).resolve().parents[2] / ".runtime"
    ):
        parser.error("--backup-dir must be beneath the repository .runtime/")
    manifest = json.loads(args.manifest.read_text())
    with website_client(url=args.url, profile=args.profile, profile_dir=args.profile_dir) as client:
        if args.command == "prepare":
            result = prepare(client, manifest)
        elif args.command == "apply":
            result = apply_layout(
                client, manifest, args.backup_dir, lambda value: write_json(args.output, value)
            )
        else:
            result = verify_layout(client, manifest)
        write_json(args.output, result)
        print(json.dumps({"command": args.command, "output": str(args.output)}))
        if args.command == "verify" and any(not item["verified"] for item in result):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
