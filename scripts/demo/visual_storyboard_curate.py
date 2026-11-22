"""Inspect, apply and verify explicitly curated storyboards through the public SDK.

Run with ``uv run python -m scripts.demo.visual_storyboard_curate --help``.
The manifest is a reviewed content input, not an automatic node-to-shot classifier.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
from uuid import UUID, uuid5

import httpx
from future_props_lab import ApiError
from future_props_lab.generated.models import StoryboardOut, StoryboardUpdate
from future_props_lab.website import website_client


def digest(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    ).hexdigest()


def dump(value):
    return value.model_dump(mode="json")


def write_json(path: Path, value, *, exclusive=False):
    """Private, durable output; recovery snapshots can never be overwritten."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    flags = os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW
    flags |= os.O_EXCL if exclusive else os.O_TRUNC
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
        stream.flush()
        os.fsync(stream.fileno())


def shot_id(project_id, key):
    return str(uuid5(UUID(project_id), "curated-storyboard:" + key))


def canvas_digest(canvas):
    # Include inputs, final selections and references, not the timestamp alone.
    return digest({key: value for key, value in canvas.items() if key != "updated_at"})


def normalize_shots(shots):
    normalized = dump(StoryboardOut.model_validate({"revision": 0, "shots": shots}))["shots"]
    # Generated read models use None for an omitted default_factory list; the
    # write contract requires an array, just like the workbench's normalization.
    for shot in normalized:
        if shot["card_ids"] is None:
            shot["card_ids"] = []
    return normalized


def inspect(client, project_ids):
    authority = client.automation.capabilities()
    available = {project.id: project for project in client.visual.list_projects().items}
    if missing := set(project_ids) - available.keys():
        raise ValueError(f"Projects unavailable to authenticated account: {sorted(missing)}")
    projects = []
    for project_id in project_ids:
        script = None
        if "visual.get_visual_script" in authority.operations:
            script = dump(client.visual.get_visual_script(project_id=project_id))
        projects.append(
            {
                "project": dump(available[project_id]),
                "canvas": dump(client.visual.get_canvas(project_id=project_id)),
                "storyboard": dump(client.visual.get_storyboard(project_id=project_id)),
                "script": script,
            }
        )
    return {"user_id": authority.user_id, "projects": projects}


def validate_entry(entry, canvas):
    """Reject wrong-project links, duplicate logical shots and unaccounted media."""
    project_id = entry["project_id"]
    if canvas["project_id"] != project_id:
        raise ValueError("Canvas belongs to a different project")
    nodes = {node["id"]: node for node in canvas["nodes"]}
    keys, ids, assigned = set(), set(), set()
    for record in entry["records"]:
        key, shot = record["key"], record["shot"]
        if key in keys or shot["id"] in ids or shot["id"] != shot_id(project_id, key):
            raise ValueError("Duplicate or unstable shot identity")
        keys.add(key)
        ids.add(shot["id"])
        if not record.get("evidence"):
            raise ValueError("Every shot requires an evidence summary")
        for field, kind in (("image_node_id", "image"), ("video_node_id", "video")):
            if identity := shot.get(field):
                if nodes.get(identity, {}).get("kind") != kind:
                    raise ValueError(f"Invalid project reference: {field}={identity}")
        if identity := shot.get("origin_node_id"):
            if nodes.get(identity, {}).get("kind") not in {"image", "video"}:
                raise ValueError("Invalid origin node")
        members = record["node_ids"]
        if len(members) != len(set(members)) or assigned.intersection(members):
            raise ValueError("A media node was assigned to multiple shot records")
        for identity in members:
            if nodes.get(identity, {}).get("kind") not in {"image", "video"}:
                raise ValueError("Shot member is not project media")
        for field in ("image_node_id", "video_node_id", "origin_node_id"):
            if shot.get(field) and shot[field] not in members:
                raise ValueError("Linked node missing from shot members")
        assigned.update(members)
    excluded = entry.get("excluded", [])
    excluded_ids = [item["node_id"] for item in excluded]
    if len(set(excluded_ids)) != len(excluded_ids) or assigned.intersection(excluded_ids):
        raise ValueError("Duplicate or already assigned exclusion")
    if any(not item.get("reason") for item in excluded):
        raise ValueError("Every excluded media node requires a reason")
    media = {identity for identity, node in nodes.items() if node["kind"] in {"image", "video"}}
    if media != assigned | set(excluded_ids):
        raise ValueError("Manifest must account for every media node exactly once")
    normalize_shots([record["shot"] for record in entry["records"]])


def target_shots(entry):
    before = normalize_shots(entry["before"]["shots"])
    additions = normalize_shots([record["shot"] for record in entry["records"]])
    if {shot["id"] for shot in before} & {shot["id"] for shot in additions}:
        raise ValueError("Curated identities collide with existing storyboard")
    return normalize_shots(before + additions)


def check_account(client, manifest):
    if client.automation.capabilities().user_id != manifest["user_id"]:
        raise ValueError("Authenticated account does not match reviewed manifest")
    entries = manifest["projects"]
    project_ids = [entry["project_id"] for entry in entries]
    if len(project_ids) != len(set(project_ids)):
        raise ValueError("Duplicate projects")
    available = {item.id for item in client.visual.list_projects().items}
    if set(project_ids) - available:
        raise ValueError("Manifest contains unavailable projects")


def check_current(client, entry):
    project_id = entry["project_id"]
    canvas = dump(client.visual.get_canvas(project_id=project_id))
    if canvas_digest(canvas) != entry["canvas_sha256"]:
        raise ValueError(f"Canvas changed since content review: {project_id}; review it again")
    validate_entry(entry, canvas)
    current = dump(client.visual.get_storyboard(project_id=project_id))
    return canvas, current, target_shots(entry)


def same_shots(document, shots):
    return normalize_shots(document["shots"]) == shots


def apply_project(client, entry, backup_dir):
    project_id = entry["project_id"]
    canvas, current, shots = check_current(client, entry)
    if same_shots(current, shots):
        return {"project_id": project_id, "status": "unchanged", "shots": len(shots)}
    before = entry["before"]
    if current["revision"] != before["revision"] or not same_shots(
        current, normalize_shots(before["shots"])
    ):
        raise ValueError("Storyboard changed since review; preserving concurrent edits")
    # Validate the complete document, including the inherited shots and its size.
    body = StoryboardUpdate.model_validate(
        {"expected_revision": current["revision"], "shots": shots}
    )
    backup = backup_dir / f"{project_id}-r{current['revision']}-{digest(shots)[:16]}.json"
    recovery = {
        "project_id": project_id,
        "before": current,
        "target_sha256": digest(shots),
        "canvas_sha256": canvas_digest(canvas),
    }
    try:
        write_json(backup, recovery, exclusive=True)
    except FileExistsError:
        if json.loads(backup.read_text()) != recovery:
            raise ValueError("Recovery point collision") from None
    try:
        client.visual.save_storyboard(project_id=project_id, body=body)
    except (httpx.TransportError, ApiError):
        # PUT has no operation receipt. Never replay an uncertain write blindly.
        confirmed = dump(client.visual.get_storyboard(project_id=project_id))
        if not same_shots(confirmed, shots):
            raise
    confirmed = dump(client.visual.get_storyboard(project_id=project_id))
    if not same_shots(confirmed, shots):
        raise ValueError("Read-back differs from reviewed storyboard")
    after_canvas = dump(client.visual.get_canvas(project_id=project_id))
    if canvas_digest(after_canvas) != canvas_digest(canvas):
        raise ValueError("Canvas changed during save; storyboard saved, needs review")
    return {
        "project_id": project_id,
        "status": "saved",
        "shots": len(shots),
        "revision": confirmed["revision"],
        "backup": str(backup.resolve()),
    }


def apply_manifest(client, manifest, backup_dir, on_result=lambda _result: None):
    check_account(client, manifest)
    # Validate every project before the first mutation.
    for entry in manifest["projects"]:
        _, current, target = check_current(client, entry)
        if not same_shots(current, target) and (
            current["revision"] != entry["before"]["revision"]
            or not same_shots(current, normalize_shots(entry["before"]["shots"]))
        ):
            raise ValueError(f"Storyboard changed: {entry['project_id']}")
        StoryboardUpdate.model_validate({"expected_revision": current["revision"], "shots": target})
    results = []
    for entry in manifest["projects"]:
        try:
            result = apply_project(client, entry, backup_dir)
        except (ValueError, httpx.HTTPError, ApiError) as failure:
            result = {
                "project_id": entry["project_id"],
                "status": "needs_review",
                "reason": type(failure).__name__,
            }
            results.append(result)
            on_result(results)
            raise
        results.append(result)
        on_result(results)
    return results


def verify_manifest(client, manifest):
    check_account(client, manifest)
    results = []
    for entry in manifest["projects"]:
        _, current, shots = check_current(client, entry)
        results.append(
            {
                "project_id": entry["project_id"],
                "title": entry["title"],
                "shots": len(shots),
                "revision": current["revision"],
                "verified": same_shots(current, shots),
            }
        )
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", required=True)
    parser.add_argument("--profile-dir", type=Path)
    parser.add_argument("--profile", default="default")
    commands = parser.add_subparsers(dest="command", required=True)
    scan = commands.add_parser("inspect")
    scan.add_argument("--project-id", action="append", required=True)
    scan.add_argument("--output", type=Path, required=True)
    for name in ("apply", "verify"):
        command = commands.add_parser(name)
        command.add_argument("--manifest", type=Path, required=True)
        command.add_argument("--output", type=Path, required=True)
        if name == "apply":
            command.add_argument("--backup-dir", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "apply":
        # Recovery material must outlive disposable analysis folders.
        root = Path(__file__).resolve().parents[2] / ".runtime"
        if not args.backup_dir.resolve().is_relative_to(root):
            parser.error("--backup-dir must be beneath the repository .runtime/")
    with website_client(url=args.url, profile=args.profile, profile_dir=args.profile_dir) as client:
        if args.command == "inspect":
            result = inspect(client, args.project_id)
        else:
            manifest = json.loads(args.manifest.read_text())
            if args.command == "apply":
                result = apply_manifest(
                    client,
                    manifest,
                    args.backup_dir,
                    lambda value: write_json(args.output, value),
                )
            else:
                result = verify_manifest(client, manifest)
        write_json(args.output, result)
        print(json.dumps({"output": str(args.output), "command": args.command}))
        if args.command == "verify" and any(not item["verified"] for item in result):
            raise SystemExit(1)


if __name__ == "__main__":
    main()
